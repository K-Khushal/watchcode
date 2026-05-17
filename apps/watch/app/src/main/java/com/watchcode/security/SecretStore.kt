package com.watchcode.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted storage for the paired watch credentials.
 * Backed by [EncryptedSharedPreferences] so secrets survive reinstall only
 * if the MasterKey survives (it won't after a factory reset, requiring re-pair).
 */
class SecretStore(context: Context) {

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    val watchId: String? get() = prefs.getString(KEY_WATCH_ID, null)
    val secret: String? get() = prefs.getString(KEY_SECRET, null)

    val isPaired: Boolean get() = watchId != null && secret != null

    fun save(watchId: String, secret: String) {
        prefs.edit()
            .putString(KEY_WATCH_ID, watchId)
            .putString(KEY_SECRET, secret)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val FILE_NAME = "watchcode_secrets"
        private const val KEY_WATCH_ID = "watch_id"
        private const val KEY_SECRET = "secret"
    }
}
