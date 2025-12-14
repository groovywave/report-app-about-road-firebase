document.addEventListener('DOMContentLoaded', async function () {
    let map;
    let markers = [];
    let reports = [];

    // 地図の初期化
    function initMap() {
        // 日本全体を表示（データ読み込み後に調整）
        map = L.map('admin-map').setView([36.2048, 138.2529], 5);

        L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
            attribution: "地理院タイル（GSI）",
            maxZoom: 18
        }).addTo(map);
    }

    // データの読み込み
    async function loadReports() {
        try {
            const db = firebase.firestore();
            const snapshot = await db.collection('reports')
                .orderBy('timestamp', 'desc')
                .limit(100)
                .get();

            const listEl = document.getElementById('report-list');
            listEl.innerHTML = ''; // クリア

            if (snapshot.empty) {
                listEl.innerHTML = '<li class="report-item" style="text-align: center;">データがありません</li>';
                return;
            }

            const bounds = L.latLngBounds();

            snapshot.forEach(doc => {
                const data = doc.data();
                const id = doc.id;
                reports.push({ id, ...data });

                // リストアイテム作成
                const li = createListItem(id, data);
                listEl.appendChild(li);

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
                        highlightListItem(id);
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
                `<li class="report-item" style="color: red;">エラーが発生しました: ${error.message}</li>`;
        }
    }

    function createListItem(id, data) {
        const li = document.createElement('li');
        li.className = 'report-item';
        li.dataset.id = id;

        const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('ja-JP') : '日時不明';
        const type = data.type || '不明';
        const details = data.details || '詳細なし';
        const photoUrl = data.photoUrl || '';

        let imageHtml = '';
        if (photoUrl) {
            imageHtml = `<img src="${photoUrl}" class="report-image-thumb" loading="lazy" alt="現場写真">`;
        }

        const status = data.status || '未処理';
        const statusClass = status === '処理済' ? 'status-processed' : 'status-unprocessed';

        li.innerHTML = `
            <div class="report-header">
                <div>
                    <span class="report-type">${type}</span>
                    <span class="report-status ${statusClass}">${status}</span>
                </div>
                <span class="report-date">${date}</span>
            </div>
            <div class="report-details">${details}</div>
            <div class="status-control" style="margin-top: 10px; display: none;">
                <select class="status-select" onchange="updateStatus('${id}', this.value)">
                    <option value="未処理" ${status === '未処理' ? 'selected' : ''}>未処理</option>
                    <option value="処理済" ${status === '処理済' ? 'selected' : ''}>処理済</option>
                </select>
            </div>
            ${imageHtml}
        `;

        li.addEventListener('click', (e) => {
            // セレクトボックスのクリックイベントは伝播させない
            if (e.target.tagName === 'SELECT') return;

            focusOnMap(id, data.latitude, data.longitude);
            highlightListItem(id);
        });

        return li;
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
            // 画面リロードして反映（簡易実装）
            // location.reload(); 
            // リロードせずにUIだけ更新するほうがスマートだが、今回は確実性のためにリロード推奨
            // ただし、ユーザー体験のためにトースト表示などを入れたいところ。
            // ここでは簡易的にアラートを出してリロード
            alert('ステータスを更新しました');
            location.reload();
        } catch (error) {
            console.error("Error updating status: ", error);
            alert('更新に失敗しました: ' + error.message);
        }
    };

    function highlightListItem(id) {
        // 全てのactiveクラスを削除
        document.querySelectorAll('.report-item').forEach(item => {
            item.classList.remove('active');
        });

        // 指定されたIDのアイテムをactiveにする
        const target = document.querySelector(`.report-item[data-id="${id}"]`);
        if (target) {
            target.classList.add('active');
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // ステータス変更コントロールを表示
            const control = target.querySelector('.status-control');
            if (control) control.style.display = 'block';
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
    initMap();
    // Firebaseの初期化を待ってからロード
    // init.jsが読み込まれると firebase.apps.length > 0 になるはず
    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            clearInterval(checkFirebase);
            loadReports();
        }
    }, 100);
});
