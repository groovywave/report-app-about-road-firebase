// 認証後に呼び出される関数
window.startAdminApp = function (user) {
    console.log('Starting email admin app for:', user.email);
    loadRecipients();
};

async function loadRecipients() {
    // タイムアウト設定（10秒）
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('読み込みがタイムアウトしました。')), 10000)
    );

    try {
        const db = firebase.firestore();
        // Firestoreの取得とタイムアウトを競走させる
        const snapshot = await Promise.race([
            db.collection('mail_recipients').orderBy('name').get(),
            timeoutPromise
        ]);

        const tbody = document.getElementById('recipient-list');
        tbody.innerHTML = '';

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">登録された宛先はありません</td></tr>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(data.name)}</td>
                <td>${escapeHtml(data.email)}</td>
                <td>
                    <button class="btn-delete" onclick="deleteRecipient('${doc.id}', '${escapeHtml(data.name)}')">削除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (error) {
        console.error("Error loading recipients:", error);
        alert('読み込みに失敗しました: ' + error.message);
    }
}

async function addRecipient() {
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name || !email) {
        alert('氏名とメールアドレスを入力してください');
        return;
    }

    if (!email.includes('@')) {
        alert('正しいメールアドレスを入力してください');
        return;
    }

    try {
        const db = firebase.firestore();
        await db.collection('mail_recipients').add({
            name: name,
            email: email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        nameInput.value = '';
        emailInput.value = '';
        loadRecipients(); // リロード
        alert('追加しました');

    } catch (error) {
        console.error("Error adding recipient:", error);
        alert('追加に失敗しました: ' + error.message);
    }
}

async function deleteRecipient(id, name) {
    if (!confirm(`${name} さんを削除してもよろしいですか？`)) {
        return;
    }

    try {
        const db = firebase.firestore();
        await db.collection('mail_recipients').doc(id).delete();
        loadRecipients(); // リロード
    } catch (error) {
        console.error("Error deleting recipient:", error);
        alert('削除に失敗しました: ' + error.message);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// グローバル関数として公開
window.addRecipient = addRecipient;
window.deleteRecipient = deleteRecipient;
