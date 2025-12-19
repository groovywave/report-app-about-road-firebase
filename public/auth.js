// 認証ロジックとログインUIの管理

// ログインオーバーレイを即座に作成・表示（Firebase初期化前でも）
createLoginOverlay();
showLoginOverlay();

document.addEventListener('DOMContentLoaded', function () {
    // Firebaseの初期化を待つ
    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            clearInterval(checkFirebase);
            initAuth();
        }
    }, 100);
});

let isAppStarted = false;

function initAuth() {
    const auth = firebase.auth();

    // 認証状態の監視
    auth.onAuthStateChanged(user => {
        if (user) {
            // ログイン済み
            console.log('Logged in as:', user.email);
            hideLoginOverlay();
            showLogoutButton(user.email);

            // メインアプリの開始（各ページで定義されている関数を呼ぶ）
            // 二重起動防止
            if (window.startAdminApp && !isAppStarted) {
                isAppStarted = true;
                window.startAdminApp(user);
            } else if (!window.startAdminApp) {
                console.error('window.startAdminApp is not defined! admin.js may not be loaded correctly.');
                alert('管理画面のプログラム読み込みに失敗しました。ページを再読み込みしてください。');
            }
        } else {
            // 未ログイン
            console.log('Not logged in');
            isAppStarted = false;
            showLoginOverlay();
            hideLogoutButton();
        }
    });
}

function createLoginOverlay() {
    // すでに存在すれば何もしない
    if (document.getElementById('login-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'login-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    `;

    const loginBox = document.createElement('div');
    loginBox.style.cssText = `
        background-color: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        width: 100%;
        max-width: 400px;
        text-align: center;
    `;

    loginBox.innerHTML = `
        <h2 style="margin-bottom: 20px; color: #333;">管理者ログイン</h2>
        <div style="margin-bottom: 15px; text-align: left;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">メールアドレス</label>
            <input type="email" id="login-email" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>
        <div style="margin-bottom: 20px; text-align: left;">
            <label style="display: block; margin-bottom: 5px; font-weight: bold;">パスワード</label>
            <input type="password" id="login-password" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        </div>
        <button id="login-btn" style="width: 100%; padding: 12px; background-color: #3498db; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">ログイン</button>
        <p id="login-error" style="color: #e74c3c; margin-top: 15px; display: none;"></p>
    `;

    overlay.appendChild(loginBox);
    document.body.appendChild(overlay);

    // イベントリスナー
    const loginBtn = document.getElementById('login-btn');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');

    async function handleLogin() {
        const email = emailInput.value;
        const password = passwordInput.value;

        loginBtn.disabled = true;
        loginBtn.textContent = 'ログイン中...';
        errorMsg.style.display = 'none';

        try {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            // 成功すれば onAuthStateChanged が発火してオーバーレイが消える
        } catch (error) {
            console.error('Login error:', error);
            errorMsg.textContent = 'ログインに失敗しました: ' + error.message;
            errorMsg.style.display = 'block';
            loginBtn.disabled = false;
            loginBtn.textContent = 'ログイン';
        }
    }

    loginBtn.addEventListener('click', handleLogin);

    // Enterキーでもログイン
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
}

function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showLogoutButton(email) {
    // ヘッダー内のログアウトボタンコンテナを探す（なければ作る）
    let logoutContainer = document.getElementById('logout-container');
    if (!logoutContainer) {
        // admin-headerの中に挿入を試みる
        const header = document.querySelector('.admin-header');
        if (header) {
            logoutContainer = document.createElement('div');
            logoutContainer.id = 'logout-container';
            logoutContainer.style.cssText = 'display: flex; align-items: center; margin-left: auto;';

            // 既存の要素（更新ボタンなど）の前に挿入するか、末尾に追加するか
            // ここでは末尾に追加（flexなので右端に行くはず）
            header.appendChild(logoutContainer);
        }
    }

    if (logoutContainer) {
        logoutContainer.innerHTML = `
            <span style="margin-right: 10px; font-size: 12px;">${email}</span>
            <button onclick="firebase.auth().signOut()" style="background: none; border: 1px solid white; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                <i class="fas fa-sign-out-alt"></i> ログアウト
            </button>
        `;
    }
}

function hideLogoutButton() {
    const logoutContainer = document.getElementById('logout-container');
    if (logoutContainer) {
        logoutContainer.innerHTML = '';
    }
}
