# Road Reporting App (Google Cloud Version)

This is a port of the [Road Reporting App](https://zenn.dev/hasenori/articles/ad38206ab84250) from Google Apps Script (GAS) to Google Cloud (Cloud Functions + Firestore + Cloud Storage).

## Prerequisites

1.  **Google Cloud Project**: Create a project in the Google Cloud Console.
    *   Enable **Billing**.
    *   Enable **Cloud Functions API**, **Firestore API**, **Cloud Storage API**.
2.  **LINE Developers Channel**:
    *   Create a **Messaging API** channel.
    *   Create a **LINE Login** channel.
3.  **Firebase CLI**: Install using `npm install -g firebase-tools`.

## Setup

1.  **Initialize Firebase Project**:
    ```bash
    firebase login
    firebase init
    ```
    *   Select **Functions** and **Hosting** (optional, if you want to host the frontend on Firebase Hosting).
    *   Select your Google Cloud project.
    *   Select **JavaScript**.
    *   Install dependencies: `cd functions && npm install`

2.  **Configure Environment Variables**:
    Set the LINE channel credentials in Cloud Functions configuration:
    ```bash
    firebase functions:config:set line.channel_access_token="YOUR_MESSAGING_CHANNEL_ACCESS_TOKEN" line.login_channel_id="YOUR_LOGIN_CHANNEL_ID"
    ```

3.  **Frontend Configuration**:
    *   Open `public/script.js`.
    *   Replace `YOUR_LIFF_ID` with your LINE Login Channel's LIFF ID.
    *   (After deployment) Replace `CLOUD_FUNCTION_URL` with the deployed function URL.

## Deployment

1.  **Deploy Cloud Functions**:
    ```bash
    firebase deploy --only functions
    ```
    *   Note the **Function URL** from the output (e.g., `https://us-central1-your-project.cloudfunctions.net/report`).
    *   Update `public/script.js` with this URL.

2.  **Deploy Frontend** (to Firebase Hosting):
    ```bash
    firebase deploy --only hosting
    ```
    *   Or deploy the `public` folder to any static hosting service (Cloudflare Pages, Netlify, GitHub Pages).

## Architecture

*   **Frontend**: HTML/CSS/JS (Leaflet.js for maps, LIFF SDK for LINE integration).
*   **Backend**: Google Cloud Functions (Node.js).
*   **Database**: Firestore (Collection: `reports`).
*   **Storage**: Cloud Storage (Bucket: default).

## Notes

*   **CORS**: The Cloud Function is configured to allow CORS (`cors({ origin: true })`).
*   **Authentication**: The backend verifies the LINE Access Token sent from the frontend to ensure the request comes from a valid LINE user.
*   **Photo Upload**: Photos are uploaded as Base64 strings, decoded in the Cloud Function, and saved to Cloud Storage.
