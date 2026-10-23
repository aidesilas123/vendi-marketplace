// android/app/src/main/java/com/vendi/app/VendiMessagingService.java
package com.vendi.app;

import android.app.ActivityManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/**
 * Builds rich chat notifications with inline Reply + Mark as read.
 *
 * FCM `notification` payloads are rendered by the Android system, which allows
 * zero action buttons. So chat pushes arrive DATA-ONLY (vendi_rich=1) and this
 * service builds the notification itself:
 *   - sender avatar as the big picture (WhatsApp-style expanded view)
 *   - "Reply" with an inline input box (RemoteInput); the send arrow takes the
 *     Vendi orange accent via setColor() on most devices
 *   - "Mark as read" which queues the read for the app (no Supabase keys here)
 *
 * When the app is in the foreground we skip the native notification — the
 * in-app push banner covers it.
 */
public class VendiMessagingService extends FirebaseMessagingService {

    public static final String ACTION_QUICK_REPLY = "com.vendi.app.QUICK_REPLY";
    public static final String ACTION_DEEP_LINK = "com.vendi.app.DEEP_LINK";
    public static final String ACTION_FOREGROUND_PUSH = "com.vendi.app.FOREGROUND_PUSH";
    public static final String REMOTE_INPUT_KEY = "quick_reply";

    private static final int VENDI_ORANGE = 0xFFF97316;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> d = remoteMessage.getData();

        // Foreground: the in-app banner covers EVERY type. Forward the payload
        // to the WebView (MainActivity owns the bridge) and stop here. This
        // matters because Android may deliver the message to this service
        // instead of the Capacitor plugin's — without the forward, the
        // plugin's pushNotificationReceived never fires and no banner appears.
        if (isAppInForeground()) {
            forwardToBanner(remoteMessage, d);
            return;
        }

        if (!"1".equals(d.get("vendi_rich")) || !"chat".equals(d.get("type"))) {
            return; // not ours — the Capacitor plugin handles everything else
        }

        String title = d.get("title");
        String body = d.get("body");
        String imageUrl = d.get("image");
        String route = d.get("route");
        String channelId = d.get("channel_id");
        if (channelId == null || channelId.isEmpty()) channelId = "vendi_default";

        String txRef = d.get("tx_ref");
        String readerId = d.get("reader_id");
        int notifId = ("vendi_chat_" + (txRef != null ? txRef : title)).hashCode();

        // Content tap -> open the chat (via the shared deep-link path).
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setAction(ACTION_DEEP_LINK);
        openIntent.putExtra("route", route);
        PendingIntent contentPI = PendingIntent.getActivity(
                this, notifId, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Reply -> inline input box in the shade. MUST be mutable so the
        // system can attach the RemoteInput result. MainActivity extracts the
        // text and deep-links into the chat, which sends it.
        RemoteInput remoteInput = new RemoteInput.Builder(REMOTE_INPUT_KEY)
                .setLabel("Reply")
                .build();
        Intent replyIntent = new Intent(this, MainActivity.class);
        replyIntent.setAction(ACTION_QUICK_REPLY);
        replyIntent.putExtra("route", route);
        replyIntent.putExtra("notif_id", notifId);
        PendingIntent replyPI = PendingIntent.getActivity(
                this, notifId, replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                0, "Reply", replyPI)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(true)
                .build();

        // Mark as read -> receiver queues it; the app applies it on next open.
        Intent markIntent = new Intent(this, ChatActionReceiver.class);
        markIntent.setAction(ChatActionReceiver.ACTION_MARK_READ);
        markIntent.putExtra("notif_id", notifId);
        markIntent.putExtra("tx_ref", txRef);
        markIntent.putExtra("reader_id", readerId);
        PendingIntent markPI = PendingIntent.getBroadcast(
                this, notifId + 100003, markIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Action markAction = new NotificationCompat.Action.Builder(
                0, "Mark as read", markPI).build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setColor(VENDI_ORANGE) // tints the inline-reply send arrow orange
                .setColorized(false)
                .setContentIntent(contentPI)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .addAction(replyAction)
                .addAction(markAction);

        // WhatsApp-style expanded view with the sender's photo.
        Bitmap avatar = downloadBitmap(imageUrl);
        if (avatar != null) {
            builder.setLargeIcon(avatar);
            builder.setStyle(new NotificationCompat.BigPictureStyle()
                    .bigPicture(avatar)
                    .setSummaryText(body));
        } else {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }

        NotificationManagerCompat.from(this).notify(notifId, builder.build());
    }

    /**
     * Hand a foreground push to the WebView as a `vendi-push-received` event
     * (the PushBanner listens for it). Data-only chat carries title/body in
     * `data`; notification payloads carry them on the notification itself.
     */
    private void forwardToBanner(RemoteMessage msg, Map<String, String> d) {
        String title;
        String body;
        RemoteMessage.Notification n = msg.getNotification();
        if ("1".equals(d.get("vendi_rich")) || n == null) {
            title = d.get("title");
            body = d.get("body");
        } else {
            title = n.getTitle();
            body = n.getBody();
        }
        if (title == null || title.isEmpty()) return;
        try {
            Intent intent = new Intent(ACTION_FOREGROUND_PUSH);
            intent.setPackage(getPackageName());
            intent.putExtra("title", title);
            intent.putExtra("body", body != null ? body : "");
            String route = d.get("route");
            intent.putExtra("route", route != null ? route : "");
            sendBroadcast(intent);
        } catch (Exception ignored) {}
    }

    private boolean isAppInForeground() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return false;
            List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
            if (procs == null) return false;
            for (ActivityManager.RunningAppProcessInfo p : procs) {
                if (p.processName.equals(getPackageName())) {
                    return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private Bitmap downloadBitmap(String url) {
        if (url == null || url.isEmpty()) return null;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.connect();
            InputStream in = conn.getInputStream();
            Bitmap bmp = BitmapFactory.decodeStream(in);
            in.close();
            return bmp;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
