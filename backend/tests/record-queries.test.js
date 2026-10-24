const { pagination, validatedSearch } = require('../recordQueries');

describe('bounded record queries', () => {
    test('pagination clamps untrusted page and limit values', () => {
        expect(pagination({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10, offset: 10 });
        expect(pagination({ page: '-1', limit: '9999' })).toEqual({ page: 1, limit: 100, offset: 0 });
    });

    test('search accepts ordinary record and address text', () => {
        expect(validatedSearch("INC-AM-0002 O'Brien, Block 4")).toBe("INC-AM-0002 O'Brien, Block 4");
    });

    test.each(['%admin%', 'x; DROP TABLE users', '<script>', 'name\\escape'])(
        'search rejects wildcard, SQL-like, markup, and escape characters: %s',
        value => expect(() => validatedSearch(value)).toThrow(/Search may contain only/)
    );
});
