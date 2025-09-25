// Clean code that should not trigger any warnings
const _ = require('lodash');

function processData(input) {
    if (!Array.isArray(input)) {
        return [];
    }
    
    return _.uniq(input.map(item => {
        if (typeof item === 'string') {
            return item.toLowerCase().trim();
        }
        return String(item);
    }));
}

function calculateSum(numbers) {
    return numbers.reduce((sum, num) => sum + num, 0);
}

module.exports = {
    processData,
    calculateSum
};
