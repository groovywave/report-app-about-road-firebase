// 認証後に呼び出される関数
window.startAdminApp = function (user) {
    console.log('Starting admin app for:', user.email);
    initMap();
    loadReports();
};



let map;
let markers = [];
let reports = [];

// 地図の初期化
function initMap() {
    if (map) return;
    // 日本全体を表示（データ読み込み後に調整）
    map = L.map('admin-map').setView([36.2048, 138.2529], 5);

    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        attribution: "地理院タイル（GSI）",
        maxZoom: 18
    }).addTo(map);
}

// データの読み込み
async function loadReports() {
    // タイムアウト設定（10秒）
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('読み込みがタイムアウトしました。ネットワーク接続を確認してください。')), 10000)
    );

    try {
        const db = firebase.firestore();
        // Firestoreの取得とタイムアウトを競走させる
        const snapshot = await Promise.race([
            db.collection('reports').limit(100).get(),
            timeoutPromise
        ]);

        const tbody = document.getElementById('report-list');
        tbody.innerHTML = ''; // クリア

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">データがありません</td></tr>';
            return;
        }

        const bounds = L.latLngBounds();

        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            reports.push({ id, ...data });

            // テーブル行作成
            const tr = createTableRow(id, data);
            tbody.appendChild(tr);

            // マーカー作成
            if (data.latitude && data.longitude) {
                const marker = L.marker([data.latitude, data.longitude])
                    .addTo(map)
                    .bindPopup(createPopupContent(data));

                marker.reportId = id;
                markers.push(marker);
                bounds.extend([data.latitude, data.longitude]);

                // マーカークリックイベント
                marker.on('click', () => {
                    highlightTableRow(id);
                });
            }
        });

        // 全マーカーが入るようにズーム調整
        if (markers.length > 0) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }

    } catch (error) {
        console.error("Error getting documents: ", error);
        document.getElementById('report-list').innerHTML =
            `<tr><td colspan="8" style="color: red;">エラーが発生しました: ${error.message}</td></tr>`;
    }
}

function createTableRow(id, data) {
    const tr = document.createElement('tr');
    tr.dataset.id = id;

    const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('ja-JP') : '日時不明';
    const type = data.type || '不明';
    const details = data.details || '';
    const lat = data.latitude ? data.latitude.toFixed(6) : '-';
    const lng = data.longitude ? data.longitude.toFixed(6) : '-';
    const googleMapLink = data.googleMapLink || '#';
    const photoUrl = data.photoUrl || '';
    const status = data.status || '未処理';

    // ステータス選択肢
    const statusOptions = `
            <select class="status-select" onchange="updateStatus('${id}', this.value)">
                <option value="未処理" ${status === '未処理' ? 'selected' : ''}>未処理</option>
                <option value="処理済" ${status === '処理済' ? 'selected' : ''}>処理済</option>
            </select>
        `;

    // 写真リンク
    let photoHtml = '-';
    if (photoUrl) {
        photoHtml = `<a href="${photoUrl}" target="_blank"><img src="${photoUrl}" class="thumb-img" loading="lazy" alt="写真"></a>`;
    }

    // Google Mapリンク
    let mapLinkHtml = '-';
    if (data.googleMapLink) {
        mapLinkHtml = `<a href="${data.googleMapLink}" target="_blank" class="map-link"><i class="fas fa-map-marker-alt"></i> Map</a>`;
    }

    tr.innerHTML = `
            <td>${statusOptions}</td>
            <td>${date}</td>
            <td>${type}</td>
            <td>${details}</td>
            <td>${lat}, ${lng}</td>
            <td>${mapLinkHtml}</td>
            <td>${photoHtml}</td>
            <td class="id-cell" title="${id}">${id}</td>
        `;

    tr.addEventListener('click', (e) => {
        // インタラクティブ要素（セレクト、リンク）のクリックは無視
        if (['SELECT', 'A', 'IMG', 'I'].includes(e.target.tagName)) return;

        focusOnMap(id, data.latitude, data.longitude);
        highlightTableRow(id);
    });

    return tr;
}

function createPopupContent(data) {
    const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('ja-JP') : '日時不明';
    const status = data.status || '未処理';
    let content = `<b>${data.type}</b> <span style="font-size:12px; color:${status === '処理済' ? 'green' : 'red'}">(${status})</span><br>${date}<br>${data.details || ''}`;
    if (data.photoUrl) {
        content += `<br><img src="${data.photoUrl}" style="width:100%; max-width:200px; margin-top:5px; border-radius:4px;">`;
    }
    if (data.googleMapLink) {
        content += `<br><a href="${data.googleMapLink}" target="_blank">Google Mapで見る</a>`;
    }
    return content;
}

// グローバル関数として定義（HTMLから呼ぶため）
window.updateStatus = async function (id, newStatus) {
    try {
        const db = firebase.firestore();
        await db.collection('reports').doc(id).update({
            status: newStatus
        });
        // 簡易的にトースト表示（本来はライブラリなど使うと良い）
        // alert('ステータスを更新しました'); 
        // リロードせず、行の色を変えるなどの処理だけでも良いが、今回はシンプルに

        // 行のスタイル更新（未処理/処理済の色分けなどあれば）
        // 今回はセレクトボックスの値が変わるだけなので特になし
        console.log('Status updated to ' + newStatus);
    } catch (error) {
        console.error("Error updating status: ", error);
        alert('更新に失敗しました: ' + error.message);
    }
};

function highlightTableRow(id) {
    // 全てのactiveクラスを削除
    document.querySelectorAll('tr').forEach(item => {
        item.classList.remove('active');
    });

    // 指定されたIDの行をactiveにする
    const target = document.querySelector(`tr[data-id="${id}"]`);
    if (target) {
        target.classList.add('active');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function focusOnMap(id, lat, lng) {
    if (lat && lng) {
        map.setView([lat, lng], 16);
        const marker = markers.find(m => m.reportId === id);
        if (marker) {
            marker.openPopup();
        }
    }
}

// 実行

