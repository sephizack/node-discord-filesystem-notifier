
beforeAll(() => {

});

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {

});

afterAll(() => {
});


test('Dummy test', async () => {
    
    expect(true).toBe(true);
});

