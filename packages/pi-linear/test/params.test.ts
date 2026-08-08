import { describe, it, expect } from 'vitest';
import { paginationVariables } from '../extensions/params';

describe('paginationVariables', () => {
  it('defaults to forward pagination with the default page size', () => {
    expect(paginationVariables({}, 50)).toEqual({ first: 50 });
  });

  it('passes forward pagination and shared options through', () => {
    expect(
      paginationVariables(
        { after: 'cursor-1', first: 10, includeArchived: true, orderBy: 'updatedAt' },
        50,
      ),
    ).toEqual({ after: 'cursor-1', first: 10, includeArchived: true, orderBy: 'updatedAt' });
  });

  it('uses backward pagination when before or last is given', () => {
    expect(paginationVariables({ before: 'cursor-2' }, 50)).toEqual({
      before: 'cursor-2',
      last: 50,
    });
    expect(paginationVariables({ last: 5 }, 50)).toEqual({ last: 5 });
  });

  it('rejects mixing forward and backward pagination', () => {
    expect(() => paginationVariables({ first: 10, before: 'cursor' }, 50)).toThrow(
      'Use either forward pagination (first/after) or backward pagination (last/before), not both.',
    );
  });
});
