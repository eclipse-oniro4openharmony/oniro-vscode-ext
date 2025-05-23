import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { encryptPwd, createMaterial } from './encrypt_key';
import * as json5 from "json5";

// Function to copy necessary files to the project directory
function copyFilesToProject(projectDir: string, KEYSTORE_FILE: string, PROFILE_CERT_FILE: string, UNSIGNED_PROFILE_TEMPLATE: string): void {
    console.log("Copying files to project directory...");
    const signaturesDir = path.join(projectDir, "signatures");
    fs.mkdirSync(signaturesDir, { recursive: true });

    fs.copyFileSync(KEYSTORE_FILE, path.join(signaturesDir, "OpenHarmony.p12"));
    fs.copyFileSync(PROFILE_CERT_FILE, path.join(signaturesDir, "OpenHarmonyProfileRelease.pem"));
    fs.copyFileSync(UNSIGNED_PROFILE_TEMPLATE, path.join(signaturesDir, "UnsgnedReleasedProfileTemplate.json"));
    console.log("Files copied successfully.");
}

// Function to modify the profile template with the app's bundle name and distribution certificate
function modifyProfileTemplate(projectDir: string): void {
    console.log("Modifying profile template...");
    const appJsonPath = path.join(projectDir, "AppScope/app.json5");
    const profileTemplatePath = path.join(projectDir, "signatures/UnsgnedReleasedProfileTemplate.json");
    const profileCertFilePath = path.join(projectDir, "signatures/OpenHarmonyProfileRelease.pem");

    if (!fs.existsSync(appJsonPath)) {
        console.error(`Error: ${appJsonPath} does not exist.`);
        process.exit(1);
    }

    let appJson: any;
    try {
        appJson = json5.parse(fs.readFileSync(appJsonPath, "utf-8"));
    } catch (e: any) {
        console.error(`Error parsing ${appJsonPath}: ${e.message}`);
        process.exit(1);
    }

    let profileTemplate: any;
    try {
        profileTemplate = JSON.parse(fs.readFileSync(profileTemplatePath, "utf-8"));
    } catch (e: any) {
        console.error(`Error parsing ${profileTemplatePath}: ${e.message}`);
        process.exit(1);
    }

    if (!appJson["app"] || !appJson["app"]["bundleName"]) {
        console.error(`Error: app.json5 does not contain the required fields.`);
        process.exit(1);
    }

    if (!profileTemplate["bundle-info"]) {
        console.error(`Error: UnsgnedReleasedProfileTemplate.json does not contain the required fields.`);
        process.exit(1);
    }

    profileTemplate["bundle-info"]["bundle-name"] = appJson["app"]["bundleName"];

    // Extract the third certificate from OpenHarmonyProfileRelease.pem
    const certContent = fs.readFileSync(profileCertFilePath, "utf-8");
    const certs = certContent.split("-----END CERTIFICATE-----");
    if (certs.length < 3) {
        console.error(`Error: ${profileCertFilePath} does not contain enough certificates.`);
        process.exit(1);
    }
    const thirdCert = certs[2].trim() + "\n-----END CERTIFICATE-----\n";
    profileTemplate["bundle-info"]["distribution-certificate"] = thirdCert;

    fs.writeFileSync(profileTemplatePath, JSON.stringify(profileTemplate, null, 2));
    console.log("Profile template modified successfully.");
}

// Function to generate the P7b file using the signing tool
function generateP7bFile(projectDir: string, SIGN_TOOL_PATH: string, PROFILE_CERT_FILE: string, KEYSTORE_FILE: string): void {
    console.log("Generating P7b file...");
    const signaturesDir = path.join(projectDir, "signatures");
    const profileTemplatePath = path.join(signaturesDir, "UnsgnedReleasedProfileTemplate.json");
    const outputProfilePath = path.join(signaturesDir, "app1-profile.p7b");

    const command = `java -jar ${SIGN_TOOL_PATH} sign-profile \
    -keyAlias "openharmony application profile release" \
    -signAlg "SHA256withECDSA" \
    -mode "localSign" \
    -profileCertFile "${PROFILE_CERT_FILE}" \
    -inFile "${profileTemplatePath}" \
    -keystoreFile "${KEYSTORE_FILE}" \
    -outFile "${outputProfilePath}" \
    -keyPwd "123456" \
    -keystorePwd "123456"`;

    execSync(command);
    console.log("P7b file generated successfully.");
}

// Function to update the build profile with encrypted passwords and signing configs
function updateBuildProfile(projectDir: string): void {
    console.log("Updating build profile...");
    const materialDir = path.join(projectDir, "signatures", "material");
    const buildProfilePath = path.join(projectDir, "build-profile.json5");

    const encryptedStorePassword = encryptPwd("123456", materialDir);
    const encryptedKeyPassword = encryptPwd("123456", materialDir);

    let buildProfile: any;
    if (fs.existsSync(buildProfilePath)) {
        try {
            buildProfile = json5.parse(fs.readFileSync(buildProfilePath, "utf-8"));
        } catch (e: any) {
            console.error(`Error parsing ${buildProfilePath}: ${e.message}`);
            process.exit(1);
        }
    } else {
        buildProfile = { app: {} };
    }

    buildProfile.app.signingConfigs = [
        {
            name: "default",
            material: {
                certpath: "./signatures/OpenHarmonyProfileRelease.pem",
                storePassword: encryptedStorePassword,
                keyAlias: "openharmony application profile release",
                keyPassword: encryptedKeyPassword,
                profile: "./signatures/app1-profile.p7b",
                signAlg: "SHA256withECDSA",
                storeFile: "./signatures/OpenHarmony.p12"
            }
        }
    ];

    fs.writeFileSync(buildProfilePath, json5.stringify(buildProfile, null, 2));
    console.log("Build profile updated successfully.");
}

// Function to prepare the material directory by creating necessary files
function prepareMaterialDirectory(projectDir: string): void {
    console.log("Preparing material directory...");
    const materialDir = path.join(projectDir, "signatures", "material");

    if (fs.existsSync(materialDir)) {
        fs.rmSync(materialDir, { recursive: true, force: true });
        console.log("Existing material directory removed.");
    }

    createMaterial(materialDir);
    console.log("Material directory prepared successfully.");
}

// Main function to orchestrate the signing configuration generation
export function generateSigningConfigs(projectDir?: string, SDK_HOME?: string): void {
    if (!projectDir) {
        console.log("No project directory provided. Using the current directory.");
        projectDir = process.cwd();
    }
    if (!SDK_HOME) {
        throw new Error("SDK_HOME must be provided.");
    }

    // Define constants for SDK paths inside the function
    const SIGN_TOOL_PATH = path.join(SDK_HOME, "12/toolchains/lib/hap-sign-tool.jar");
    const KEYSTORE_FILE = path.join(SDK_HOME, "12/toolchains/lib/OpenHarmony.p12");
    const PROFILE_CERT_FILE = path.join(SDK_HOME, "12/toolchains/lib/OpenHarmonyProfileRelease.pem");
    const UNSIGNED_PROFILE_TEMPLATE = path.join(SDK_HOME, "12/toolchains/lib/UnsgnedReleasedProfileTemplate.json");

    console.log("Starting signing configuration generation...");
    copyFilesToProject(projectDir, KEYSTORE_FILE, PROFILE_CERT_FILE, UNSIGNED_PROFILE_TEMPLATE);
    modifyProfileTemplate(projectDir);
    generateP7bFile(projectDir, SIGN_TOOL_PATH, PROFILE_CERT_FILE, KEYSTORE_FILE);
    prepareMaterialDirectory(projectDir);
    updateBuildProfile(projectDir);

    console.log("Signing configuration generated successfully.");
}

// If run directly, execute main logic
if (require.main === module) {
    const projectDir = process.argv[2];
    const SDK_HOME = process.env.OHOS_BASE_SDK_HOME || "";
    if (!SDK_HOME) {
        console.error("Error: OHOS_BASE_SDK_HOME environment variable is not set.");
        process.exit(1);
    }
    generateSigningConfigs(projectDir, SDK_HOME);
}
