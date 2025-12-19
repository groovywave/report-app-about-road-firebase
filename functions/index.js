const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const nodemailer = require("nodemailer");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// 環境変数から設定を取得
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const LIFF_ID = process.env.LIFF_ID;

const LINE_MESSAGING_API_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_API_URL = 'https://api.line.me/v2/profile';
const LINE_VERIFY_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';

exports.config = functions.region('asia-northeast1').https.onRequest((req, res) => {
    cors(req, res, () => {
        res.json({
            LIFF_ID: LIFF_ID
        });
    });
});

exports.report = functions.region('asia-northeast1').https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).send('Method Not Allowed');
        }

        try {
            const rawData = req.body;
            console.log('Request data received:', JSON.stringify(rawData));

            // 1. データの検証とサニタイズ
            const validatedData = validateAndSanitizeData(rawData);

            // 2. ユーザー認証
            let userId = null;
            if (validatedData.accessToken) {
                userId = await getUserIdFromAccessToken(validatedData.accessToken);
                validatedData.userId = userId;
            } else {
                throw new Error('アクセストークンが見つかりません。認証が必要です。');
            }

            // 3. データベース保存 (Firestore & Storage)
            const saveResult = await saveToFirestoreAndStorage(validatedData);

            // 4. LINE通知
            let lineResult = null;
            if (userId && LINE_CHANNEL_ACCESS_TOKEN) {
                lineResult = await sendLineMessage(userId, validatedData, saveResult);
            }

            // 5. メール通知
            try {
                // 宛先リストを取得
                const recipientsSnapshot = await db.collection('mail_recipients').get();
                const recipients = [];
                recipientsSnapshot.forEach(doc => {
                    const rData = doc.data();
                    if (rData.email && rData.email.includes('@')) {
                        recipients.push(rData.email);
                    }
                });

                if (recipients.length > 0) {
                    const gmailConfig = functions.config().gmail;
                    const gmailEmail = gmailConfig ? gmailConfig.email : null;
                    const gmailPassword = gmailConfig ? gmailConfig.password : null;

                    if (gmailEmail && gmailPassword) {
                        const transporter = nodemailer.createTransport({
                            service: 'gmail',
                            auth: {
                                user: gmailEmail,
                                pass: gmailPassword
                            }
                        });

                        const subject = `【道路通報】新規通報（種別：${validatedData.type}）`;
                        let mailBody = "新しい道路通報がありましたので、お知らせします。\n\n";
                        mailBody += "----------------------------------------\n";
                        mailBody += "■ 通報内容\n";
                        mailBody += "----------------------------------------\n";
                        mailBody += `・受付日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n`;
                        mailBody += `・通報種別: ${validatedData.type}\n`;
                        mailBody += `・詳細: ${validatedData.details || '記載なし'}\n\n`;
                        mailBody += `・場所の確認（Googleマップ）:\n${saveResult.googleMapLink}\n\n`;

                        if (saveResult.photoUrl) {
                            mailBody += `・写真の確認:\n${saveResult.photoUrl}\n\n`;
                        } else {
                            mailBody += "・写真: なし\n\n";
                        }
                        mailBody += "----------------------------------------\n";
                        // Cloud FunctionsのURLではなく、Firebase HostingのURLを使用する
                        // プロジェクトIDからHostingのURLを構築（または環境変数で管理しても良いが、今回は簡易的に構築）
                        const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG?.projectId;
                        const hostingUrl = `https://${projectId}.web.app`;
                        mailBody += `管理画面: ${hostingUrl}/admin.html\n`;
                        mailBody += `配信設定: ${hostingUrl}/admin_email.html\n`;

                        const mailOptions = {
                            from: `"Road Report App" <${gmailEmail}>`,
                            to: recipients.join(','),
                            subject: subject,
                            text: mailBody
                        };

                        await transporter.sendMail(mailOptions);
                        console.log('Email sent to:', recipients);
                    } else {
                        console.log('Gmail config not found. Skipping email.');
                    }
                } else {
                    console.log('No recipients found. Skipping email.');
                }
            } catch (mailError) {
                console.error('Error sending email:', mailError);
                // メール送信失敗しても、通報自体は成功とするためエラーは投げない
            }

            res.status(200).json({
                status: 'success',
                message: '通報を受け付けました。ご協力ありがとうございます。',
                timestamp: new Date().toISOString(),
                id: saveResult.id,
                lineNotified: !!lineResult,
                imageUploaded: !!saveResult.photoUrl
            });

        } catch (error) {
            console.error('Error processing request:', error);
            res.status(500).json({
                status: 'error',
                message: 'データの処理に失敗しました: ' + error.message
            });
        }
    });
});

function validateAndSanitizeData(rawData) {
    const latitude = parseFloat(rawData.latitude);
    const longitude = parseFloat(rawData.longitude);

    if (isNaN(latitude) || isNaN(longitude) || !rawData.type) {
        throw new Error('必須フィールド（緯度、経度、種別）が無効または不足しています。');
    }

    // photoDataの検証
    if (rawData.photoData) {
        // サイズチェック (簡易)
        if (rawData.photoData.length > 7 * 1024 * 1024) { // Base64で約7MB (元ファイル5MB程度)
            throw new Error('画像サイズが大きすぎます。');
        }
        if (!rawData.photoData.startsWith('data:image/')) {
            throw new Error('無効な画像データ形式です。');
        }
    }

    let photoMimeType = null;
    if (rawData.photoData) {
        photoMimeType = rawData.photoData.substring(5, rawData.photoData.indexOf(';'));
    }

    return {
        latitude,
        longitude,
        type: sanitizeText(rawData.type),
        details: rawData.details ? sanitizeText(rawData.details) : '',
        photoData: rawData.photoData || null,
        photoMimeType,
        accessToken: rawData.accessToken || null
    };
}

function sanitizeText(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getUserIdFromAccessToken(accessToken) {
    try {
        // トークン検証
        const verifyResponse = await axios.get(`${LINE_VERIFY_TOKEN_URL}?access_token=${accessToken}`);
        if (verifyResponse.data.client_id !== LINE_LOGIN_CHANNEL_ID) {
            throw new Error('チャネルIDが一致しません。');
        }

        // プロフィール取得
        const profileResponse = await axios.get(LINE_PROFILE_API_URL, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });
        return profileResponse.data.userId;
    } catch (error) {
        console.error('Authentication error:', error.response ? error.response.data : error.message);
        throw new Error('ユーザー認証に失敗しました。');
    }
}

async function saveToFirestoreAndStorage(data) {
    try {
        let photoUrl = '';
        let storagePath = '';

        // 写真保存
        if (data.photoData && data.photoMimeType) {
            const base64Data = data.photoData.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `reports/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
            const file = bucket.file(filename);

            await file.save(buffer, {
                metadata: { contentType: data.photoMimeType },
                public: true // 公開設定 (必要に応じて変更)
            });

            photoUrl = file.publicUrl();
            storagePath = filename;
        }

        const googleMapLink = `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`;

        // Firestore保存
        const docRef = await db.collection('reports').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: '未処理', // デフォルトステータス
            latitude: data.latitude,
            longitude: data.longitude,
            googleMapLink,
            type: data.type,
            details: data.details,
            photoUrl,
            storagePath,
            userId: data.userId
        });

        return {
            id: docRef.id,
            photoUrl,
            googleMapLink
        };
    } catch (error) {
        console.error('Database/Storage error:', error);
        throw new Error('データの保存に失敗しました。');
    }
}

async function sendLineMessage(userId, reportData, saveResult) {
    try {
        const messages = [];

        // Flex Message
        messages.push(createFlexMessage(reportData, saveResult.photoUrl));

        // Location Message
        messages.push({
            type: 'location',
            title: '通報場所',
            address: `緯度: ${reportData.latitude}, 経度: ${reportData.longitude}`,
            latitude: reportData.latitude,
            longitude: reportData.longitude
        });

        // Image Message
        if (saveResult.photoUrl) {
            messages.push({
                type: 'image',
                originalContentUrl: saveResult.photoUrl,
                previewImageUrl: saveResult.photoUrl
            });
        }

        // Text Message
        messages.push({
            type: 'text',
            text: createLineTextMessage(reportData, saveResult.googleMapLink, saveResult.photoUrl)
        });

        await axios.post(LINE_MESSAGING_API_URL, {
            to: userId,
            messages: messages
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
            }
        });

        return true;
    } catch (error) {
        console.error('LINE Messaging API error:', error.response ? error.response.data : error.message);
        // LINE送信失敗はメイン処理のエラーとしない
        return false;
    }
}

function createFlexMessage(data, photoUrl) {
    return {
        type: 'flex',
        altText: '道路異状通報を受け付けました',
        contents: {
            type: 'bubble',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: '🚧 道路異状通報', weight: 'bold', color: '#ffffff', size: 'lg' },
                    { type: 'text', text: '受付完了', color: '#ffffff', size: 'sm' }
                ],
                backgroundColor: '#3498db',
                paddingAll: 'lg'
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            { type: 'text', text: '受付日時', color: '#666666', size: 'sm' },
                            { type: 'text', text: new Date().toLocaleString('ja-JP'), weight: 'bold', size: 'md', margin: 'xs' }
                        ],
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            { type: 'text', text: '通報種別', color: '#666666', size: 'sm' },
                            { type: 'text', text: data.type, weight: 'bold', size: 'md', margin: 'xs', color: '#e74c3c' }
                        ],
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        contents: [
                            { type: 'text', text: '詳細情報', color: '#666666', size: 'sm' },
                            { type: 'text', text: data.details || '記載なし', size: 'md', margin: 'xs', wrap: true }
                        ],
                        margin: 'md'
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        action: {
                            type: 'uri',
                            label: '🗺️ 地図で確認',
                            uri: `https://www.google.com/maps?q=${data.latitude},${data.longitude}`
                        },
                        color: '#27ae60'
                    }
                ],
                margin: 'md'
            }
        }
    };
}

function createLineTextMessage(data, mapLink, photoLink) {
    const timestamp = new Date().toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
    let message = `📋 通報詳細\n\n`;
    message += `🔸 種別: ${data.type}\n`;
    message += `🔸 詳細: ${data.details || '記載なし'}\n`;
    message += `🔸 受付日時: ${timestamp}\n\n`;
    if (mapLink) {
        message += `📍 場所の確認:\n${mapLink}\n\n`;
    }
    if (photoLink) {
        message += `📷 写真の確認:\n${photoLink}\n\n`;
    }
    message += `📍 通報を受け付けました。\n`;
    message += `ご協力ありがとうございました。`;
    return message;
}
