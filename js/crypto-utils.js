// 用 Web Crypto 在本机加密保存 API Key。
// 密钥本身存在 device_key 表（不随 JSON 备份导出），密文和 iv 才存进 connections 表。
// 这不是"绝对安全"，只是避免明文躺在 IndexedDB/日志/导出文件里；仍然建议优先使用自建后端 Relay。

const CryptoUtils = (() => {
  let cachedKey = null;

  async function getDeviceKey() {
    if (cachedKey) return cachedKey;
    const existing = await DB.get('device_key', 'device-aes-key');
    if (existing) {
      cachedKey = await crypto.subtle.importKey(
        'raw', existing.raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
      );
      return cachedKey;
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    await DB.put('device_key', { id: 'device-aes-key', raw });
    cachedKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return cachedKey;
  }

  function toBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function fromBase64(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
  }

  async function encryptText(plainText) {
    if (!plainText) return { cipher: '', iv: '' };
    const key = await getDeviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plainText);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { cipher: toBase64(cipherBuf), iv: toBase64(iv.buffer) };
  }

  async function decryptText(cipher, iv) {
    if (!cipher) return '';
    const key = await getDeviceKey();
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(fromBase64(iv)) }, key, fromBase64(cipher)
    );
    return new TextDecoder().decode(plainBuf);
  }

  return { encryptText, decryptText };
})();
