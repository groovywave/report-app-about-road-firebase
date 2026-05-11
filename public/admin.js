// 認証後に呼び出される関数
window.startAdminApp = function (user) {
    console.log('Starting admin app for:', user.email);
    initMap();
    loadReports();
};



let map;
let markers = [];
let reports = [];
let lastDoc = null;

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
        let query = db.collection('reports').orderBy('timestamp', 'desc');

        // 日付フィルターの適用
        const startInput = document.getElementById('filter-start')?.value;
        const endInput = document.getElementById('filter-end')?.value;

        if (startInput) {
            const startDate = new Date(startInput + "T00:00:00");
            query = query.where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startDate));
        }
        if (endInput) {
            const endDate = new Date(endInput + "T23:59:59");
            query = query.where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(endDate));
        }

        query = query.limit(100);

        // Firestoreの取得とタイムアウトを競走させる
        const snapshot = await Promise.race([
            query.get(),
            timeoutPromise
        ]);

        const tbody = document.getElementById('report-list');
        tbody.innerHTML = ''; // クリア

        const loadMoreBtn = document.getElementById('load-more-btn');

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">データがありません</td></tr>';
            if (loadMoreBtn) loadMoreBtn.style.display = 'none';
            return;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        if (loadMoreBtn) {
            if (snapshot.docs.length < 100) {
                loadMoreBtn.style.display = 'none';
            } else {
                loadMoreBtn.style.display = 'inline-block';
                loadMoreBtn.innerHTML = '<i class="fas fa-chevron-down"></i> 次へ（さらに100件）';
                loadMoreBtn.disabled = false;
            }
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
    const status = data.status || '未処理';

    // ステータス選択肢
    const statusOptions = `
            <select class="status-select" onchange="updateStatus('${id}', this.value)">
                <option value="未処理" ${status === '未処理' ? 'selected' : ''}>未処理</option>
                <option value="処理済" ${status === '処理済' ? 'selected' : ''}>処理済</option>
            </select>
        `;

    // 写真リンク
    let photoHtml = '';
    if (data.photoUrlDistant) {
        photoHtml += `<a href="${data.photoUrlDistant}" target="_blank" title="遠景"><img src="${data.photoUrlDistant}" class="thumb-img" loading="lazy" alt="遠景"></a> `;
    }
    if (data.photoUrlClose) {
        photoHtml += `<a href="${data.photoUrlClose}" target="_blank" title="近景"><img src="${data.photoUrlClose}" class="thumb-img" loading="lazy" alt="近景"></a>`;
    }
    if (!photoHtml) photoHtml = '-';

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
    if (data.photoUrlDistant) {
        content += `<br><span style="font-size:10px; color:#555;">[遠景]</span><br><img src="${data.photoUrlDistant}" style="width:100%; max-width:200px; margin-top:2px; border-radius:4px;">`;
    }
    if (data.photoUrlClose) {
        content += `<br><span style="font-size:10px; color:#555;">[近景]</span><br><img src="${data.photoUrlClose}" style="width:100%; max-width:200px; margin-top:2px; border-radius:4px;">`;
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

// 追加読み込み機能
window.loadNextReports = async function () {
    if (!lastDoc) return;

    const btn = document.getElementById('load-more-btn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 読み込み中...';
        btn.disabled = true;
    }

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('読み込みがタイムアウトしました。ネットワーク接続を確認してください。')), 10000)
    );

    try {
        const db = firebase.firestore();
        let query = db.collection('reports').orderBy('timestamp', 'desc');

        // 日付フィルターの適用
        const startInput = document.getElementById('filter-start')?.value;
        const endInput = document.getElementById('filter-end')?.value;

        if (startInput) {
            const startDate = new Date(startInput + "T00:00:00");
            query = query.where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startDate));
        }
        if (endInput) {
            const endDate = new Date(endInput + "T23:59:59");
            query = query.where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(endDate));
        }

        query = query.startAfter(lastDoc).limit(100);

        const snapshot = await Promise.race([
            query.get(),
            timeoutPromise
        ]);

        if (snapshot.empty) {
            if (btn) {
                btn.innerHTML = 'これ以上データはありません';
                btn.disabled = true;
            }
            return;
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        const tbody = document.getElementById('report-list');
        const bounds = L.latLngBounds();

        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            reports.push({ id, ...data });

            const tr = createTableRow(id, data);
            tbody.appendChild(tr);

            if (data.latitude && data.longitude) {
                const marker = L.marker([data.latitude, data.longitude])
                    .addTo(map)
                    .bindPopup(createPopupContent(data));

                marker.reportId = id;
                markers.push(marker);
                bounds.extend([data.latitude, data.longitude]);

                marker.on('click', () => {
                    highlightTableRow(id);
                });
            }
        });

        if (btn) {
            if (snapshot.docs.length < 100) {
                btn.style.display = 'none';
            } else {
                btn.innerHTML = '<i class="fas fa-chevron-down"></i> 次へ（さらに100件）';
                btn.disabled = false;
            }
        }

    } catch (error) {
        console.error("Error getting next documents: ", error);
        alert('追加読み込みに失敗しました: ' + error.message);
        if (btn) {
            btn.innerHTML = '<i class="fas fa-chevron-down"></i> 次へ（さらに100件）';
            btn.disabled = false;
        }
    }
};

// フィルターボタンのアクション
window.filterReports = function() {
    // 現在のマーカーをすべて削除
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    reports = [];
    lastDoc = null;

    const tbody = document.getElementById('report-list');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #777;"><i class="fas fa-spinner fa-spin"></i> 検索中...</td></tr>';
    
    // 表示ボタンの無効化（連打防止）
    const filterBtn = document.querySelector('.filter-btn');
    if (filterBtn) filterBtn.disabled = true;

    loadReports().finally(() => {
        if (filterBtn) filterBtn.disabled = false;
    });
};

// CSVダウンロード
window.downloadCSV = function() {
    if (reports.length === 0) {
        alert('ダウンロードするデータがありません。');
        return;
    }

    // CSVヘッダー
    const headers = ['ID', 'ステータス', '受付日時', '通報種別', '詳細', '緯度', '経度', 'GoogleマップURL', '写真_遠景', '写真_近景'];
    
    // データ行の作成
    const rows = reports.map(r => {
        const date = r.timestamp ? new Date(r.timestamp.toDate()).toLocaleString('ja-JP') : '';
        return [
            r.id,
            r.status || '未処理',
            date,
            r.type || '',
            r.details || '',
            r.latitude || '',
            r.longitude || '',
            r.googleMapLink || '',
            r.photoUrlDistant || '',
            r.photoUrlClose || ''
        ].map(escapeCSV); // 各フィールドをエスケープ処理
    });

    // ヘッダーと行を結合
    const csvContent = [headers.map(escapeCSV).join(',')].concat(rows.map(row => row.join(','))).join('\n');

    // UTF-8 BOM付きでBlobを作成
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv' });

    // ダウンロードリンクの作成とクリック
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // ファイル名の生成（例: reports_20231015.csv）
    const today = new Date();
    const yyyymmdd = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    
    a.href = url;
    a.download = `reports_${yyyymmdd}.csv`;
    a.click();
    
    URL.revokeObjectURL(url);
};

// CSV用のエスケープ処理（カンマ、改行、ダブルクォーテーション対策）
function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // 全てのダブルクォーテーションを2重にする
    str = str.replace(/"/g, '""');
    // フィールド全体をダブルクォーテーションで囲む
    return `"${str}"`;
}

