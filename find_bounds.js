const fs = require('fs');
const content = fs.readFileSync('ui.xml', 'utf8');
const regex = /text="([^"]+)"[^>]*bounds="([^"]+)"/g;
let m;
while ((m = regex.exec(content)) !== null) {
  console.log(`${m[1]} -> ${m[2]}`);
}
