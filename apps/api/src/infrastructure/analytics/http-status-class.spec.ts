import { httpStatusClass } from './http-status-class';

describe('httpStatusClass', () => {
  it('buckets 2xx / 4xx / 5xx', () => {
    expect(httpStatusClass(200)).toBe('2xx');
    expect(httpStatusClass(201)).toBe('2xx');
    expect(httpStatusClass(404)).toBe('4xx');
    expect(httpStatusClass(500)).toBe('5xx');
    expect(httpStatusClass(503)).toBe('5xx');
  });
});
