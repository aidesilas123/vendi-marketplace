// android/app/src/main/java/com/vendi/app/ChatActionReceiver.java
package com.vendi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Handles the "Mark as read" notification action for chat pushes.
 *
 * Deliberately does NO network: no Supabase keys live in native code.
 * It dismisses the notification and appends the conversation to a queue in
 * the CapacitorStorage prefs file; the JS app (AppShell) applies the read
 * with its own authenticated client on next open.
 */
public class ChatActionReceiver extends BroadcastReceiver {

    public static final String ACTION_MARK_READ = "com.vendi.app.MARK_READ";
    private static final String QUEUE_KEY = "vendi_pending_mark_read";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_MARK_READ.equals(intent.getAction())) return;

        int notifId = intent.getIntExtra("notif_id", 0);
        if (notifId != 0) {
            try {
                NotificationManagerCompat.from(context).cancel(notifId);
            } catch (Exception ignored) {}
        }

        String txRef = intent.getStringExtra("tx_ref");
        String readerId = intent.getStringExtra("reader_id");
        if (txRef == null || readerId == null) return;

        try {
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            JSONArray queue;
            try {
                queue = new JSONArray(prefs.getString(QUEUE_KEY, "[]"));
            } catch (Exception e) {
                queue = new JSONArray();
            }
            JSONObject entry = new JSONObject();
            entry.put("txRef", txRef);
            entry.put("readerId", readerId);
            entry.put("ts", System.currentTimeMillis());
            queue.put(entry);
            // Keep the queue small — only the latest 20 matter.
            while (queue.length() > 20) queue.remove(0);
            prefs.edit().putString(QUEUE_KEY, queue.toString()).apply();
        } catch (Exception ignored) {}
    }
}
