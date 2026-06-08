import admin from 'firebase-admin';
import User from '../models/User.js';
import PushNotificationLog from '../models/PushNotificationLog.js';

let fcmInitialized = false;

// Graceful Firebase Admin initialization
try {
  if (process.env.FCM_ENABLED === 'true') {
    if (admin.apps.length === 0) {
      // If service account JSON environment variable is provided, we can use it
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
          fcmInitialized = true;
          console.log('[Push Notification Service] Firebase Admin initialized via JSON payload.');
        } catch (jsonErr) {
          console.error('[Push Notification Service] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', jsonErr.message);
        }
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
        fcmInitialized = true;
        console.log('[Push Notification Service] Firebase Admin initialized via GOOGLE_APPLICATION_CREDENTIALS.');
      } else {
        console.warn('[Push Notification Service] FCM_ENABLED=true but no credentials provided. Running mock fallbacks.');
      }
    } else {
      fcmInitialized = true;
    }
  }
} catch (err) {
  console.warn('[Push Notification Service] Firebase Admin initialization failed. Falling back to mock:', err.message);
}

/**
 * Sends a push notification to a user.
 * 
 * @param {string} userId - Recipient user database ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @returns {Promise<Object>} Status response payload
 */
export const sendPushNotification = async (userId, title, body) => {
  const isEnabled = process.env.FCM_ENABLED === 'true';
  console.log(`[Push Notification] Dispatching alert to user: ${userId}. FCM Enabled: ${isEnabled}`);

  let user = null;
  try {
    user = await User.findById(userId);
  } catch (err) {
    console.error('[Push Notification] Failed to lookup user:', err.message);
  }

  const token = user?.fcmToken || null;

  if (isEnabled && fcmInitialized && token) {
    try {
      const message = {
        notification: {
          title,
          body,
        },
        token: token,
      };

      const response = await admin.messaging().send(message);
      
      // Log successful real push dispatch
      await PushNotificationLog.create({
        userId,
        title,
        body,
        deviceToken: token,
        status: 'SENT',
      });

      console.log(`[Push Notification] FCM message sent successfully: ${response}`);
      return { success: true, messageId: response };
    } catch (err) {
      console.error('[Push Notification] FCM delivery failed:', err.message);
      
      // Log failed dispatch
      await PushNotificationLog.create({
        userId,
        title,
        body,
        deviceToken: token,
        status: 'FAILED',
        error: err.message,
      });

      return { success: false, error: err.message };
    }
  }

  // Fallback / Mock delivery mode
  try {
    const log = await PushNotificationLog.create({
      userId,
      title,
      body,
      deviceToken: token || '[No Token Registered]',
      status: 'MOCK_SENT',
    });
    console.log(`[Push Notification] Mock notification logged for user: ${userId}`);
    return { success: true, messageId: 'push_mock_' + log._id };
  } catch (err) {
    console.error('[Push Notification] Failed to create mock notification log:', err.message);
    return { success: false, error: err.message };
  }
};
