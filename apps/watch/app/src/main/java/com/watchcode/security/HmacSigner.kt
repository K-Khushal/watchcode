package com.watchcode.security

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Produces HMAC-SHA256 signatures over the canonical byte representation of
 * watch→daemon messages.
 *
 * Canonical format: `v1\n<type>\n<watch_id>\n<nonce>\n<sha256-of-sorted-body-json>`
 * Body JSON is computed from all fields except `hmac`, with keys sorted alphabetically.
 *
 * NOTE: Do NOT use [org.json.JSONObject] to build the body JSON — its internal
 * storage uses a [HashMap] and does not preserve insertion order, so the
 * serialised string may have a different key order than the [sortedMapOf] passed
 * in, producing a different SHA-256 hash than the daemon expects.  Use
 * [buildSortedJson] instead.
 */
object HmacSigner {

    fun sign(
        type: String,
        watchId: String,
        nonce: Long,
        secretHex: String,
        extraFields: Map<String, Any> = emptyMap(),
    ): String {
        val bodyMap = sortedMapOf<String, Any>(
            "nonce" to nonce,
            "type" to type,
            "watch_id" to watchId,
        )
        bodyMap.putAll(extraFields)

        // Build JSON directly from the sorted TreeMap so key order is guaranteed
        // to be alphabetical and identical to what the Node.js daemon produces via
        // Object.keys(rest).sort() + JSON.stringify.
        val bodyJson = buildSortedJson(bodyMap)
        val bodyHash = sha256Hex(bodyJson.toByteArray(Charsets.UTF_8))
        val canonical = "v1\n$type\n$watchId\n$nonce\n$bodyHash".toByteArray(Charsets.UTF_8)

        val secretBytes = hexToBytes(secretHex)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secretBytes, "HmacSHA256"))
        return bytesToHex(mac.doFinal(canonical))
    }

    /**
     * Serialises a map to a compact JSON object string preserving the map's
     * iteration order (pass a [sortedMapOf] / [java.util.TreeMap] for alphabetical
     * key order). Only [String] and [Number] values are supported — this covers
     * all watch→daemon message fields.
     */
    private fun buildSortedJson(map: Map<String, Any>): String = buildString {
        append('{')
        map.entries.forEachIndexed { i, (k, v) ->
            if (i > 0) append(',')
            append('"')
            append(k)
            append('"')
            append(':')
            when (v) {
                is String -> {
                    append('"')
                    append(v)
                    append('"')
                }
                else -> append(v.toString()) // Int, Long, Double → no quotes, matches JSON.stringify
            }
        }
        append('}')
    }

    private fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return bytesToHex(digest.digest(data))
    }

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hexToBytes(hex: String): ByteArray {
        require(hex.length % 2 == 0) { "Odd-length hex string" }
        return ByteArray(hex.length / 2) { i ->
            hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
    }
}
