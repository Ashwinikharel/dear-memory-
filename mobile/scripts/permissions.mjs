// Adds camera permission to the native projects (needed for the selfie and the QR scanner).
// Safe to run many times.
import fs from 'node:fs';

const manifest = new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url);
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  const add = [
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  ].filter((line) => !xml.includes(line.split(' ')[1]));
  if (add.length) {
    xml = xml.replace(/<application/, `${add.join('\n    ')}\n\n    <application`);
    fs.writeFileSync(manifest, xml);
    console.log('Android: camera permission added');
  } else {
    console.log('Android: camera permission already present');
  }
}

const plist = new URL('../ios/App/App/Info.plist', import.meta.url);
if (fs.existsSync(plist)) {
  let xml = fs.readFileSync(plist, 'utf8');
  if (!xml.includes('NSCameraUsageDescription')) {
    xml = xml.replace(/<dict>/, `<dict>
\t<key>NSCameraUsageDescription</key>
\t<string>Dear Memory uses the camera to scan QR codes and take a selfie to find your photos.</string>`);
    fs.writeFileSync(plist, xml);
    console.log('iOS: camera usage description added');
  } else {
    console.log('iOS: camera usage description already present');
  }
}
