const { fisherYatesShuffle } = require('../src/utils/giveawayUtil');

describe('fisherYatesShuffle', () => {
    test('should return an array of the same length', () => {
        const input = [1, 2, 3, 4, 5];
        const output = fisherYatesShuffle(input);
        expect(output.length).toBe(input.length);
    });

    test('should contain all original elements', () => {
        const input = [1, 2, 3, 4, 5];
        const output = fisherYatesShuffle(input);
        expect(output.sort()).toEqual(input.sort());
    });

    test('should not modify the original array', () => {
        const input = [1, 2, 3, 4, 5];
        const inputCopy = [...input];
        fisherYatesShuffle(input);
        expect(input).toEqual(inputCopy);
    });
});
