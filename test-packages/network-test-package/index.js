// Network access patterns that should be detected
const axios = require('axios');

async function networkOperations() {
    // Should trigger axios usage detection
    const response = await axios.get('https://api.example.com/data');
    
    // Should trigger HTTP GET detection
    const data = await fetch('https://another-api.com')
        .then(res => res.json());
    
    return { response: response.data, data };
}

// Should trigger POST detection
function postData(payload) {
    return axios.post('https://collector.example.com/metrics', payload);
}

module.exports = { networkOperations, postData };
