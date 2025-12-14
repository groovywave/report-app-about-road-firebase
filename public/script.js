// script.js - Cloud Functions対応版
// ▼▼▼【重要】設定値を更新してください ▼▼▼
const APP_SETTINGS = {
    // ★★★ ここにCloud FunctionsのURLを設定してください ★★★
    CLOUD_FUNCTION_URL: 'https://asia-northeast1-road-report-app-h7n2.cloudfunctions.net/report',
    // ★★★ ここにLIFF IDを設定してください ★★★
    LIFF_ID: '2008504742-z0xNX8YL',

    MAX_RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    REQUEST_TIMEOUT: 30000,
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    DETAILS_MAX_LENGTH: 100
};
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

// グローバル変数
let currentPhoto = { data: null, mimeType: null };
let lineAccessToken = null;
let lineUserId = null;
let CONFIG = {};
let elements = {};

document.addEventListener('DOMContentLoaded', async function () {
    try {
        // 1. 環境依存の設定値を取得（無ければデフォルトで続行）
        let envConfig = {};
        try {
            const response = await fetch('/api/config', { cache: 'no-store' });
            if (response.ok) {
                envConfig = await response.json();
            } else {
                console.warn(`設定エンドポイントが見つかりませんでした: ${response.status} ${response.statusText} - デフォルト設定で起動します。`);
            }
        } catch (e) {
            console.warn('設定エンドポイントの取得に失敗しました（オフライン/ローカル想定）: デフォルト設定で起動します。', e);
        }

        // 2. 固定的な設定値とマージして、最終的なCONFIGオブジェクトを完成させる。
        CONFIG = { ...APP_SETTINGS, ...envConfig };
        console.log('アプリケーション設定が完了しました。：', CONFIG);

        // 要素の取得
        elements = {
            map: L.map('map').setView([36.871, 140.016], 16),
            coordsDisplay: document.getElementById('coords-display'),
            latInput: document.getElementById('latitude'),
            lngInput: document.getElementById('longitude'),
            form: document.getElementById('report-form'),
            btnSubmit: document.getElementById('btn-submit'),
            loader: document.getElementById('loader'),
            photoInput: document.getElementById('photo'),
            imagePreview: document.getElementById('image-preview'),
            lineStatus: document.getElementById('line-status'),
            lineStatusText: document.getElementById('line-status-text'),
            accessTokenInput: document.getElementById('accessToken'),
            userIdInput: document.getElementById('userId'),
            detailsTextarea: document.getElementById('details'), // 詳細テキストエリア
            detailsRequiredNote: document.getElementById('details-required-note'), // 注釈用span
            detailsOverlay: document.getElementById('details-overlay'), // 詳細ハイライト用オーバーレイ
            typeRadios: document.querySelectorAll('input[name="type"]') // 異常の種類ラジオボタン（すべて）
        };

        // === LIFF初期化 ===
        initializeLIFF();

        // === 地図の初期化 ===
        initializeMap(elements);

        // === フォーム機能の初期化 ===
        initializeFormFeatures(elements);

        // 初期の送信ボタン状態を更新
        updateSubmitButtonState();

    } catch (error) {
        console.error('初期化エラー：', error);
        showNotification(error.message, 'error');
    }

    // === LIFF初期化関数（修正版） ===
    async function initializeLIFF() {
        try {
            console.log('LIFF初期化開始');
            if (CONFIG.LIFF_ID === 'YOUR_LIFF_ID') {
                console.warn('LIFF_IDが設定されていません');
                updateLineStatus('warning', 'LIFF設定が必要です');
                return;
            }

            await liff.init({ liffId: CONFIG.LIFF_ID });
            console.log('LIFF初期化成功');

            if (liff.isLoggedIn()) {
                // アクセストークンを取得
                lineAccessToken = liff.getAccessToken();
                // プロフィール情報を取得
                const profile = await liff.getProfile();
                lineUserId = profile.userId;

                // ↓↓↓ この一行を追加する ↓↓↓
                console.log('【デバッグ用】取得したアクセストークン:', lineAccessToken);
                // ↑↑↑ この一行を追加する ↑↑↑

                // 隠しフィールドに設定
                elements.accessTokenInput.value = lineAccessToken;
                elements.userIdInput.value = lineUserId;

                updateLineStatus('success', `LINE連携済み: ${profile.displayName}`);
                console.log('LINEユーザー情報取得成功:', profile);
            } else {
                updateLineStatus('error', 'LINEログインが必要です');
                console.log('LINEログインが必要');
                // 自動ログインを試行
                try {
                    await liff.login();
                } catch (loginError) {
                    console.error('自動ログイン失敗:', loginError);
                }
            }
        } catch (error) {
            console.error('LIFF初期化エラー:', error);
            updateLineStatus('error', 'LINE連携エラー');
        }
    }

    // === LINE連携状態表示関数 ===
    function updateLineStatus(status, message) {
        if (!elements.lineStatus || !elements.lineStatusText) return;
        elements.lineStatus.className = `line-status ${status}`;
        elements.lineStatusText.textContent = message;
        elements.lineStatus.classList.remove('hidden');

        // 5秒後に非表示（成功時のみ）
        if (status === 'success') {
            setTimeout(() => {
                elements.lineStatus.classList.add('hidden');
            }, 5000);
        }
    }

    // === 地図初期化関数 ===
    function initializeMap(elements) {
        L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
            attribution: "地理院タイル（GSI）",
            maxZoom: 18
        }).addTo(elements.map);

        function updateCenterCoords() {
            const center = elements.map.getCenter();
            elements.coordsDisplay.innerText = `緯度: ${center.lat.toFixed(6)} 経度: ${center.lng.toFixed(6)}`;
            elements.latInput.value = center.lat;
            elements.lngInput.value = center.lng;
            // 位置が更新されたら送信ボタンの状態も更新
            updateSubmitButtonState();
        }

        elements.map.on('move', updateCenterCoords);
        updateCenterCoords();

        // 現在位置の取得
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    elements.map.setView([pos.coords.latitude, pos.coords.longitude], 18);
                },
                function (error) {
                    console.warn('位置情報の取得に失敗しました:', error);
                    showNotification('位置情報の取得に失敗しました。手動で位置を調整してください。', 'warning');
                }
            );
        }
    }

    // === フォーム機能初期化 ===
    function initializeFormFeatures(elements) {
        // 「その他」選択時に詳細を必須にするためのイベントリスナー
        elements.typeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                handleTypeChange();
                updateSubmitButtonState();
            });
        });

        // 詳細の入力を日本語換算（コードポイント）で上限制御
        if (elements.detailsTextarea) {
            const limit = CONFIG.DETAILS_MAX_LENGTH ?? 100;
            // 基本的なブラウザ側の制限（UTF-16単位）も設定
            elements.detailsTextarea.setAttribute('maxlength', String(limit));
            elements.detailsTextarea.addEventListener('input', () => {
                const chars = Array.from(elements.detailsTextarea.value || '');
                if (chars.length > limit) {
                    elements.detailsTextarea.value = chars.slice(0, limit).join('');
                }
                updateSubmitButtonState();
            });
        }

        // 詳細文字数ハイライト・注記
        if (elements.detailsTextarea && elements.detailsOverlay) {
            elements.detailsTextarea.addEventListener('input', () => {
                updateDetailsOverlayAndNote();
            });
            elements.detailsTextarea.addEventListener('scroll', () => {
                // スクロール同期（transformで追従させる）
                const st = elements.detailsTextarea.scrollTop;
                const sl = elements.detailsTextarea.scrollLeft;
                elements.detailsOverlay.style.transform = `translate(${-sl}px, ${-st}px)`;
            });
            // 初期描画
            updateDetailsOverlayAndNote();
        }

        // 初期状態のチェックも実行（必須表示含めて更新）
        handleTypeChange();

        // 写真プレビュー
        elements.photoInput.addEventListener('change', function () {
            handlePhotoInput(this, elements);
        });

        // フォーム送信
        elements.form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!elements.loader.classList.contains('sending')) {
                const formData = new FormData(this);
                handleFormSubmission(formData, elements);
            }
        });

        // フォーム全体の変化でもボタン状態を更新（保険）
        elements.form.addEventListener('input', updateSubmitButtonState);
        elements.form.addEventListener('change', updateSubmitButtonState);
    }

    // 「異常の種類」が変更されたときのハンドラ関数
    function handleTypeChange() {
        const elements = { // この関数内で使う要素を再定義
            detailsTextarea: document.getElementById('details'),
            detailsRequiredNote: document.getElementById('details-required-note'),
            otherRadio: document.getElementById('type-other') // 「その他」のラジオボタン
        };

        if (elements.otherRadio && elements.otherRadio.checked) {
            // 「その他」が選択されている場合
            elements.detailsTextarea.required = true;
            // 文字数注記を含めて更新
            updateDetailsNote();
        } else {
            // 「その他」以外が選択されている場合
            elements.detailsTextarea.required = false;
            // 文字数注記を含めて更新
            updateDetailsNote();
        }
    }

    // 詳細のオーバーレイ更新と注記更新
    function updateDetailsOverlayAndNote() {
        const textarea = document.getElementById('details');
        const overlay = document.getElementById('details-overlay');
        if (!textarea || !overlay) return;

        const limit = CONFIG.DETAILS_MAX_LENGTH ?? 100;
        const chars = Array.from(textarea.value || '');
        const count = chars.length;

        // HTMLエスケープ
        const esc = (s) => s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/ /g, '&nbsp;');

        if (count <= limit) {
            overlay.innerHTML = esc(chars.join(''));
        } else {
            const normal = chars.slice(0, limit).join('');
            const over = chars.slice(limit).join('');
            overlay.innerHTML = esc(normal) + '<span class="overflow">' + esc(over) + '</span>';
        }

        // スクロール位置を同期（入力時）
        const st = textarea.scrollTop;
        const sl = textarea.scrollLeft;
        overlay.style.transform = `translate(${-sl}px, ${-st}px)`;

        // ラベル注記の更新
        updateDetailsNote(count > limit);
    }

    // ラベル注記の更新（必須と100文字注記の併記対応）
    function updateDetailsNote(exceeded) {
        const note = document.getElementById('details-required-note');
        const otherRadio = document.getElementById('type-other');
        if (!note) return;

        const parts = [];
        if (otherRadio && otherRadio.checked) parts.push('（必須入力）');

        if (typeof exceeded === 'undefined') {
            // exceededが未指定なら、現在の入力から判定
            const len = Array.from((document.getElementById('details')?.value) || '').length;
            const limit = CONFIG.DETAILS_MAX_LENGTH ?? 100;
            if (len > limit) parts.push('（１００文字以内）');
        } else if (exceeded) {
            parts.push('（１００文字以内）');
        }

        note.textContent = parts.join('');
    }

    // === 共通ユーティリティ関数 ===
    // 通知表示（統合版）
    function showNotification(message, type = 'info') {
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) existingNotification.remove();

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };

        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            z-index: 10000;
            max-width: 300px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            background-color: ${colors[type] || colors.info};
        `;

        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    // 画像をビットマップ化してから再エンコード（JPEG）する共通関数
    async function bitmapizeAndEncode(fileOrDataUrl, options = {}) {
        const { maxWidth = 1280, maxHeight = 1280, quality = 0.85, mimeType = 'image/jpeg', background = '#fff' } = options;

        // 入力をBlobに正規化
        let srcBlob;
        if (fileOrDataUrl instanceof Blob) {
            srcBlob = fileOrDataUrl;
        } else if (typeof fileOrDataUrl === 'string') {
            // dataURLやHTTP URL想定（dataURLのみを主に想定）
            const res = await fetch(fileOrDataUrl);
            srcBlob = await res.blob();
        } else {
            throw new Error('bitmapizeAndEncode: 未対応の入力タイプです');
        }

        // デコードしてビットマップへ
        let bmp, width, height;
        try {
            // createImageBitmapが使える場合はEXIFの向き適用に期待
            // Safari等ではオプション未対応のためtry-catchでフォールバック
            bmp = await createImageBitmap(srcBlob, { imageOrientation: 'from-image' });
            width = bmp.width;
            height = bmp.height;
        } catch {
            // フォールバック: Image要素 + ObjectURL
            const url = URL.createObjectURL(srcBlob);
            try {
                const img = await new Promise((resolve, reject) => {
                    const i = new Image();
                    i.onload = () => resolve(i);
                    i.onerror = reject;
                    i.src = url;
                });
                width = img.naturalWidth || img.width;
                height = img.naturalHeight || img.height;

                // Canvasに描画してビットマップ化
                const cvs = document.createElement('canvas');
                cvs.width = width;
                cvs.height = height;
                const ctx = cvs.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // CanvasからImageBitmapへ（対応ブラウザのみ）
                if (window.createImageBitmap) {
                    bmp = await createImageBitmap(cvs);
                } else {
                    // 最低限、既にキャンバスにラスタライズ済みなのでこのまま扱う
                    bmp = cvs;
                }
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        // サイズ調整（アスペクト比維持）
        let targetW = width;
        let targetH = height;
        if (targetW > targetH) {
            if (targetW > maxWidth) {
                targetH = Math.round((maxWidth / targetW) * targetH);
                targetW = maxWidth;
            }
        } else {
            if (targetH > maxHeight) {
                targetW = Math.round((maxHeight / targetH) * targetW);
                targetH = maxHeight;
            }
        }

        // 描画用キャンバス（OffscreenCanvasがあれば利用）
        const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
        const cvs = hasOffscreen ? new OffscreenCanvas(targetW, targetH) : document.createElement('canvas');
        if (!hasOffscreen) {
            cvs.width = targetW;
            cvs.height = targetH;
        }
        const ctx = cvs.getContext('2d');

        // 透明PNG/GIF対策で背景を塗る
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(bmp, 0, 0, targetW, targetH);

        // エンコード（JPEG）
        if (cvs.convertToBlob) {
            // OffscreenCanvas
            const blob = await cvs.convertToBlob({ type: mimeType, quality });
            return await blobToDataURL(blob);
        } else {
            // HTMLCanvasElement
            const dataUrl = cvs.toDataURL(mimeType, quality);
            return dataUrl;
        }
    }

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    }

    // 写真データ更新（統合版）
    function updatePhoto(data, mimeType, elements) {
        currentPhoto.data = data;
        currentPhoto.mimeType = mimeType;
        if (data && mimeType) {
            elements.imagePreview.src = data;
            elements.imagePreview.style.display = 'block';
        } else {
            elements.imagePreview.src = '#';
            elements.imagePreview.style.display = 'none';
        }
        elements.photoInput.value = '';
    }

    // === 写真入力処理（画像圧縮機能付き） ===
    function handlePhotoInput(input, elements) {
        if (input.files && input.files[0]) {
            const file = input.files[0];

            // 元ファイルサイズのチェックはそのまま活かす
            if (file.size > CONFIG.MAX_FILE_SIZE) {
                showNotification('ファイルサイズが大きすぎます。5MB以下のファイルを選択してください。', 'error');
                updatePhoto(null, null, elements);
                return;
            }

            // ファイル形式のチェックもそのまま活かす
            if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
                showNotification('対応していないファイル形式です。', 'error');
                updatePhoto(null, null, elements);
                return;
            }

            // 必ずビットマップ化→再エンコード
            bitmapizeAndEncode(file, {
                maxWidth: 1280,
                maxHeight: 1280,
                quality: 0.85,
                mimeType: 'image/jpeg',
                background: '#fff'
            })
                .then((compressedBase64) => {
                    updatePhoto(compressedBase64, 'image/jpeg', elements);
                    console.log(`画像再エンコード完了（bitmap→jpeg）: ${Math.round(compressedBase64.length / 1024)} KB`);
                })
                .catch((err) => {
                    console.error(err);
                    showNotification('画像の再エンコードに失敗しました。', 'error');
                    updatePhoto(null, null, elements);
                });
        }
    }

    // === フォーム送信処理（修正版） ===
    async function handleFormSubmission(formData, elements) {
        try {
            setSubmissionState(true, elements);

            // バリデーション
            const validation = validateFormData(formData);
            if (!validation.isValid) {
                throw new Error(validation.message);
            }

            // データ送信
            const result = await sendDataWithRetry(formData);

            // 成功処理
            showNotification('通報を受け付けました。ご協力ありがとうございます。', 'success');
            elements.form.reset();
            updatePhoto(null, null, elements);

        } catch (error) {
            console.error('送信エラー:', error);
            showNotification(`送信に失敗しました: ${error.message}`, 'error');
        } finally {
            setSubmissionState(false, elements);
        }
    }

    function validateFormData(formData) {
        const requiredFields = [
            { name: 'latitude', label: '場所' },
            { name: 'longitude', label: '場所' },
            { name: 'type', label: '異常の種類' }
        ];

        for (const field of requiredFields) {
            const value = formData.get(field.name);
            if (!value || value.trim() === '') {
                return { isValid: false, message: field.name.includes('itude') ? '場所が指定されていません。地図を動かして位置を合わせてください。' : `${field.label}が入力されていません。` };
            }
        }

        // 「その他」が選択されている場合のみ、詳細を必須チェックする
        if (formData.get('type') === 'その他') {
            const details = formData.get('details');
            if (!details || details.trim() === '') {
                return { isValid: false, message: '「その他」を選択した場合は、詳細を必ず入力してください。' };
            }
        }

        // 詳細の文字数上限チェック（入力がある場合）
        const detailsAll = formData.get('details') || '';
        const detailsLength = Array.from(detailsAll).length;
        const limit = CONFIG.DETAILS_MAX_LENGTH ?? 100;
        if (detailsLength > limit) {
            return { isValid: false, message: '詳細は100文字以内で入力してください。' };
        }

        const lat = parseFloat(formData.get('latitude'));
        const lng = parseFloat(formData.get('longitude'));
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return { isValid: false, message: '緯度の値が正しくありません。' };
        }
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return { isValid: false, message: '経度の値が正しくありません。' };
        }

        return { isValid: true };
    }

    async function sendDataWithRetry(formData, attempt = 1) {
        try {
            if (!liff) {
                throw new Error('LIFFが初期化されていません。');
            }
            const currentAccessToken = liff.getAccessToken();
            if (!currentAccessToken) {
                throw new Error('LINEの認証情報が取得できませんでした。')
            }

            const payload = {
                latitude: formData.get('latitude'),
                longitude: formData.get('longitude'),
                type: formData.get('type'),
                details: formData.get('details'),
                photoData: currentPhoto.data,
                photoMimeType: currentPhoto.mimeType,
                accessToken: currentAccessToken, // アクセストークンを送信
                userId: lineUserId, // ユーザーIDも送信（参考用）
                timestamp: new Date().toISOString()
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

            const response = await fetch(CONFIG.CLOUD_FUNCTION_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                // mode: 'cors', // Cloud FunctionsはCORS対応が必要
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`サーバーエラー: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (data.status === 'success') {
                return data;
            } else {
                throw new Error(data.message || 'サーバーでエラーが発生しました。');
            }

        } catch (error) {
            if (attempt < CONFIG.MAX_RETRY_ATTEMPTS && shouldRetry(error)) {
                showNotification(`送信に失敗しました。${CONFIG.RETRY_DELAY / 1000}秒後に再試行します... (${attempt}/${CONFIG.MAX_RETRY_ATTEMPTS})`, 'warning');
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
                return sendDataWithRetry(formData, attempt + 1);
            }
            throw error;
        }
    }

    function shouldRetry(error) {
        return error.name === 'AbortError' || error.message.includes('fetch') || error.message.includes('network') || error.message.includes('timeout');
    }

    function setSubmissionState(isSending, elements) {
        if (isSending) {
            elements.loader.classList.remove('hidden');
            elements.loader.classList.add('sending');
        } else {
            elements.loader.classList.add('hidden');
            elements.loader.classList.remove('sending');
        }
        const formElements = elements.form.querySelectorAll('input, select, textarea, button');
        formElements.forEach(el => el.disabled = isSending);

        // 送信状態変更後にもボタン表示テキストを適切に更新
        if (!isSending) updateSubmitButtonState();
    }

    // 送信ボタンの活性/非活性とテキストを更新
    function updateSubmitButtonState() {
        if (!elements?.form || !elements?.btnSubmit) return;
        // 送信中は一律で制御しない
        if (elements.loader?.classList.contains('sending')) return;

        const formData = new FormData(elements.form);
        const selectedType = formData.get('type');
        const isOther = selectedType === 'その他';
        const detailsVal = (elements.detailsTextarea?.value || '').trim();

        const canSubmit = selectedType && (!isOther || (isOther && detailsVal.length > 0));

        elements.btnSubmit.disabled = !canSubmit;
        elements.btnSubmit.textContent = canSubmit ? 'この内容で通報する' : '不具合の種類を選択してください';
    }
});
