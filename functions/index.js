const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require('firebase-functions/params');
const admin = require("firebase-admin");
const axios = require("axios");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// v2 のためのグローバル設定（全関数共通で東京リージョンを使用）
setGlobalOptions({ region: 'asia-northeast1' });

// シークレットの定義（GMAIL_EMAIL, GMAIL_PASSWORD）
const gmailEmail = defineSecret('GMAIL_EMAIL');
const gmailPassword = defineSecret('GMAIL_PASSWORD');

// 環境変数から設定を取得
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const LIFF_ID = process.env.LIFF_ID;

const LINE_MESSAGING_API_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_API_URL = 'https://api.line.me/v2/profile';
const LINE_VERIFY_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';

exports.config = onRequest({ cors: true }, (req, res) => {
    res.json({
        LIFF_ID: LIFF_ID
    });
});

exports.report = onRequest({ cors: true, secrets: [gmailEmail, gmailPassword] }, async (req, res) => {
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
                    const emailVal = gmailEmail.value();
                    const passwordVal = gmailPassword.value();

                    if (emailVal && passwordVal) {
                        const transporter = nodemailer.createTransport({
                            service: 'gmail',
                            auth: {
                                user: emailVal,
                                pass: passwordVal
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

                        if (saveResult.photoUrlDistant || saveResult.photoUrlClose) {
                            if (saveResult.photoUrlDistant) mailBody += `・写真(遠景)の確認:\n${saveResult.photoUrlDistant}\n\n`;
                            if (saveResult.photoUrlClose) mailBody += `・写真(近景)の確認:\n${saveResult.photoUrlClose}\n\n`;
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
                            from: `"Road Report App" <${emailVal}>`,
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
                imageUploaded: !!(saveResult.photoUrlDistant || saveResult.photoUrlClose)
            });

        } catch (error) {
            console.error('Error processing request:', error);
            res.status(500).json({
                status: 'error',
                message: 'データの処理に失敗しました: ' + error.message
            });
        }
});

function validateAndSanitizeData(rawData) {
    const latitude = parseFloat(rawData.latitude);
    const longitude = parseFloat(rawData.longitude);

    if (isNaN(latitude) || isNaN(longitude) || !rawData.type) {
        throw new Error('必須フィールド（緯度、経度、種別）が無効または不足しています。');
    }

    // photoDataの検証
    if (rawData.photoDataDistant) {
        if (rawData.photoDataDistant.length > 7 * 1024 * 1024) throw new Error('遠景画像サイズが大きすぎます。');
        if (!rawData.photoDataDistant.startsWith('data:image/')) throw new Error('無効な遠景画像データ形式です。');
    }
    if (rawData.photoDataClose) {
        if (rawData.photoDataClose.length > 7 * 1024 * 1024) throw new Error('近景画像サイズが大きすぎます。');
        if (!rawData.photoDataClose.startsWith('data:image/')) throw new Error('無効な近景画像データ形式です。');
    }

    let photoMimeTypeDistant = null;
    if (rawData.photoDataDistant) {
        photoMimeTypeDistant = rawData.photoDataDistant.substring(5, rawData.photoDataDistant.indexOf(';'));
    }
    
    let photoMimeTypeClose = null;
    if (rawData.photoDataClose) {
        photoMimeTypeClose = rawData.photoDataClose.substring(5, rawData.photoDataClose.indexOf(';'));
    }

    return {
        latitude,
        longitude,
        type: sanitizeText(rawData.type),
        details: rawData.details ? sanitizeText(rawData.details) : '',
        photoDataDistant: rawData.photoDataDistant || null,
        photoMimeTypeDistant,
        photoDataClose: rawData.photoDataClose || null,
        photoMimeTypeClose,
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
        let photoUrlDistant = '';
        let storagePathDistant = '';
        let photoUrlClose = '';
        let storagePathClose = '';

        // 遠景写真保存
        if (data.photoDataDistant && data.photoMimeTypeDistant) {
            const base64Data = data.photoDataDistant.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `reports/${Date.now()}_distant_${Math.random().toString(36).substring(7)}.jpg`;
            const file = bucket.file(filename);

            await file.save(buffer, {
                metadata: { contentType: data.photoMimeTypeDistant },
                public: true
            });

            photoUrlDistant = file.publicUrl();
            storagePathDistant = filename;
        }

        // 近景写真保存
        if (data.photoDataClose && data.photoMimeTypeClose) {
            const base64Data = data.photoDataClose.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `reports/${Date.now()}_close_${Math.random().toString(36).substring(7)}.jpg`;
            const file = bucket.file(filename);

            await file.save(buffer, {
                metadata: { contentType: data.photoMimeTypeClose },
                public: true
            });

            photoUrlClose = file.publicUrl();
            storagePathClose = filename;
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
            photoUrlDistant,
            storagePathDistant,
            photoUrlClose,
            storagePathClose,
            userId: data.userId
        });

        return {
            id: docRef.id,
            photoUrlDistant,
            photoUrlClose,
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
        messages.push(createFlexMessage(reportData));

        // Location Message
        messages.push({
            type: 'location',
            title: '通報場所',
            address: `緯度: ${reportData.latitude}, 経度: ${reportData.longitude}`,
            latitude: reportData.latitude,
            longitude: reportData.longitude
        });

        // Image Message (Distant)
        if (saveResult.photoUrlDistant) {
            messages.push({
                type: 'image',
                originalContentUrl: saveResult.photoUrlDistant,
                previewImageUrl: saveResult.photoUrlDistant
            });
        }
        
        // Image Message (Close)
        if (saveResult.photoUrlClose) {
            messages.push({
                type: 'image',
                originalContentUrl: saveResult.photoUrlClose,
                previewImageUrl: saveResult.photoUrlClose
            });
        }

        // Text Message
        messages.push({
            type: 'text',
            text: createLineTextMessage(reportData, saveResult.googleMapLink, saveResult.photoUrlDistant, saveResult.photoUrlClose)
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

function createFlexMessage(data) {
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

function createLineTextMessage(data, mapLink, photoLinkDistant, photoLinkClose) {
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
    if (photoLinkDistant) {
        message += `📷 写真(遠景)の確認:\n${photoLinkDistant}\n\n`;
    }
    if (photoLinkClose) {
        message += `📷 写真(近景)の確認:\n${photoLinkClose}\n\n`;
    }
    message += `📍 通報を受け付けました。\n`;
    message += `ご協力ありがとうございました。`;
    return message;
}
