import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Constants
const DAEMON_ROOT_KEY_COMPONENT_LENGTH = 16;
const DAEMON_SALT_KEY_LENGTH = 16;
const DAEMON_WORK_KEY_LENGTH = 16;
const KEY_FILE_DIRECTORY_PERMISSIONS = 0o755;
const KEY_FILE_PERMISSIONS = 0o600;

// A fixed 16-byte constant component (same as in the reference)
const COMPONENT = Buffer.from([
  49, 243, 9, 115, 214, 175, 91, 184,
  211, 190, 177, 88, 101, 131, 192, 119
]);

/**
 * Encrypts data using AES-128-GCM.
 * The output layout is:
 *   [4 bytes: total length of ciphertext+tag] +
 *   [12 bytes: iv] +
 *   [ciphertext] +
 *   [16 bytes: auth tag]
 */
function encrypt(key: Buffer, data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const totalLength = ciphertext.length + authTag.length;
  const out = Buffer.alloc(4 + iv.length + ciphertext.length + authTag.length);
  // Write 4-byte big-endian length header
  out.writeUInt32BE(totalLength, 0);
  // Write IV (12 bytes)
  iv.copy(out, 4);
  // Write ciphertext
  ciphertext.copy(out, 16);
  // Write authentication tag (16 bytes)
  authTag.copy(out, 16 + ciphertext.length);
  return out;
}

/**
 * Decrypts data previously encrypted by the encrypt() function.
 */
function decrypt(key: Buffer, data: Buffer): Buffer {
  const totalLength = data.readUInt32BE(0);
  const iv = data.slice(4, 16);
  const ciphertextLength = totalLength - 16; // subtract tag length
  const ciphertext = data.slice(16, 16 + ciphertextLength);
  const authTag = data.slice(16 + ciphertextLength);
  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}

/**
 * Returns a Buffer that is the XOR of all input buffers.
 * All buffers must be of equal length.
 */
function xorBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("No buffers provided for XOR.");
  }
  let result = Buffer.from(buffers[0]); // make a copy
  for (let i = 1; i < buffers.length; i++) {
    const buf = buffers[i];
    if (buf.length !== result.length) {
      throw new Error("Buffers have different lengths in XOR.");
    }
    for (let j = 0; j < result.length; j++) {
      result[j] ^= buf[j];
    }
  }
  return result;
}

/**
 * Derives the root key from the fd components and salt.
 * It appends the fixed constant (COMPONENT) to the list,
 * xors them together, and then derives a 16-byte key using PBKDF2.
 */
function getRootKey(fdComponents: Buffer[], salt: Buffer): Buffer {
  const components = fdComponents.concat([COMPONENT]);
  const xored = xorBuffers(components);
  // Note: The reference code calls toString() on the XOR result.
  const derived = crypto.pbkdf2Sync(xored.toString(), salt, 10000, 16, "sha256");
  return derived;
}

/**
 * Creates a key file in the given directory.
 * Generates a random key of given length, writes it to a file
 * (the file name is the SHA-256 hash of the key), and returns the key.
 */
function createAndStoreKey(dir: string, keyLength: number): Buffer {
  const key = crypto.randomBytes(keyLength);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const filePath = path.join(dir, hash);
  fs.writeFileSync(filePath, key);
  fs.chmodSync(filePath, KEY_FILE_PERMISSIONS);
  return key;
}

/**
 * Creates and stores the encrypted work key in the "ce" folder.
 * It generates a random work key, encrypts the given root key with it,
 * and then writes the encryption output to a file (named by its SHA-256 hash).
 */
function createAndStoreEnKey(rootKey: Buffer, ceDir: string): void {
  const workKey = crypto.randomBytes(DAEMON_WORK_KEY_LENGTH);
  const encrypted = encrypt(rootKey, workKey);
  const hash = crypto.createHash("sha256").update(encrypted).digest("hex");
  const filePath = path.join(ceDir, hash);
  fs.writeFileSync(filePath, encrypted);
  fs.chmodSync(filePath, KEY_FILE_PERMISSIONS);
}

/**
 * Creates the entire "material" directory structure and files.
 */
export function createMaterial(materialPath: string): void {
  console.log("Creating material directory structure...");

  // Ensure the base material directory exists
  fs.mkdirSync(materialPath, { recursive: true });
  fs.chmodSync(materialPath, KEY_FILE_DIRECTORY_PERMISSIONS);

  // Define subdirectories
  const fdDir = path.join(materialPath, "fd");
  const acDir = path.join(materialPath, "ac");
  const ceDir = path.join(materialPath, "ce");

  fs.mkdirSync(fdDir, { recursive: true });
  fs.mkdirSync(acDir, { recursive: true });
  fs.mkdirSync(ceDir, { recursive: true });

  // Under "fd", create three subdirectories "0", "1", "2" and store one key in each
  const fdSubDirs = ["0", "1", "2"];
  const fdComponents: Buffer[] = [];
  for (const sub of fdSubDirs) {
    const subDir = path.join(fdDir, sub);
    fs.mkdirSync(subDir, { recursive: true });
    const comp = createAndStoreKey(subDir, DAEMON_ROOT_KEY_COMPONENT_LENGTH);
    fdComponents.push(comp);
  }

  // In "ac", create one salt key file
  const salt = createAndStoreKey(acDir, DAEMON_SALT_KEY_LENGTH);

  // Derive the root key
  const rootKey = getRootKey(fdComponents, salt);

  // In "ce", store the encrypted work key (the final key is later recovered by decrypting this)
  createAndStoreEnKey(rootKey, ceDir);
}

/**
 * Reads the material directory and re-derives the work key.
 * This key is used to encrypt (and later decrypt) the password.
 */
function getKey(materialPath: string): Buffer {
  // Check that the material directory exists
  if (!fs.existsSync(materialPath) || !fs.statSync(materialPath).isDirectory()) {
    throw new Error("Material directory does not exist.");
  }

  // Read the three components from "fd"
  const fdDir = path.join(materialPath, "fd");
  const fdSubDirs = ["0", "1", "2"];
  const fdComponents: Buffer[] = [];
  for (const sub of fdSubDirs) {
    const subDir = path.join(fdDir, sub);
    if (!fs.existsSync(subDir) || !fs.statSync(subDir).isDirectory()) {
      throw new Error(`Missing signing material directory: ${sub}`);
    }
    const files = fs.readdirSync(subDir).filter(f => f !== ".DS_Store");
    if (files.length !== 1) {
      throw new Error(`Signing material in ${subDir} is illegal.`);
    }
    const comp = fs.readFileSync(path.join(subDir, files[0]));
    fdComponents.push(comp);
  }

  // Read the salt from "ac"
  const acDir = path.join(materialPath, "ac");
  if (!fs.existsSync(acDir) || !fs.statSync(acDir).isDirectory()) {
    throw new Error("Missing ac directory.");
  }
  const acFiles = fs.readdirSync(acDir).filter(f => f !== ".DS_Store");
  if (acFiles.length !== 1) {
    throw new Error("Signing material error in ac.");
  }
  const salt = fs.readFileSync(path.join(acDir, acFiles[0]));

  // Derive the root key
  const rootKey = getRootKey(fdComponents, salt);

  // Read the encrypted work key from "ce"
  const ceDir = path.join(materialPath, "ce");
  if (!fs.existsSync(ceDir) || !fs.statSync(ceDir).isDirectory()) {
    throw new Error("Missing ce directory.");
  }
  const ceFiles = fs.readdirSync(ceDir).filter(f => f !== ".DS_Store");
  if (ceFiles.length !== 1) {
    throw new Error("Signing material error in ce.");
  }
  const workMaterial = fs.readFileSync(path.join(ceDir, ceFiles[0]));
  // Decrypt the work key using the root key
  const workKey = decrypt(rootKey, workMaterial);
  return workKey;
}

/**
 * Encrypts a password string using the work key derived from material.
 */
export function encryptPwd(password: string, materialPath: string): string {
  const key = getKey(materialPath);
  const pwdBuffer = Buffer.from(password, "utf-8");
  const encrypted = encrypt(key, pwdBuffer);
  return encrypted.toString("hex");
}

/**
 * Main program:
 *  - Creates the material directory (if not already present)
 *  - Encrypts or decrypts the given password using the derived work key
 *  - Logs the resulting hexadecimal ciphertext or plaintext
 */
function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: node encrypt_key.js <encrypt|decrypt> <password> <materialPath>");
    process.exit(1);
  }

  const action = args[0];
  const password = args[1];
  const materialPath = args[2];

  // Create material if it doesn't exist
  if (!fs.existsSync(materialPath)) {
    createMaterial(materialPath);
  } else {
    console.log("Using existing material directory.");
  }

  if (action === "encrypt") {
    const encryptedHex = encryptPwd(password, materialPath);
    console.log("Encrypted password (hex):", encryptedHex);
  } else if (action === "decrypt") {
    const key = getKey(materialPath);
    const encryptedBuffer = Buffer.from(password, "hex");
    const decryptedBuffer = decrypt(key, encryptedBuffer);
    console.log("Decrypted password:", decryptedBuffer.toString("utf-8"));
  } else {
    console.error("Invalid action. Use 'encrypt' or 'decrypt'.");
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main();
}
