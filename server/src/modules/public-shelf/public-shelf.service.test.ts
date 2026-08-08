import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PublicShelfService } from './public-shelf.service';

function makeService(repository: Record<string, unknown>, appDataPath = '/data') {
  const config = { get: (key: string) => (key === 'storage.appDataPath' ? appDataPath : undefined) };
  return new PublicShelfService(repository as never, config as never);
}

describe('PublicShelfService', () => {
  it('rejects duplicate book ids', async () => {
    const service = makeService({});
    await expect(service.updateMyShelf(1, [1, 1])).rejects.toMatchObject({
      response: { errorCode: 'PUBLIC_SHELF_DUPLICATE' },
    });
  });

  it('rejects shelves larger than the cap', async () => {
    const service = makeService({});
    await expect(
      service.updateMyShelf(
        1,
        Array.from({ length: 101 }, (_, i) => i + 1),
      ),
    ).rejects.toMatchObject({
      response: { errorCode: 'PUBLIC_SHELF_TOO_LARGE' },
    });
  });

  it('rejects unknown book ids before replacing the shelf', async () => {
    const repository = {
      bookIdsExist: vi.fn().mockResolvedValue(new Set([1, 2])),
      replaceShelf: vi.fn().mockResolvedValue(undefined),
    };
    const service = makeService(repository);
    await expect(service.updateMyShelf(1, [1, 2, 999])).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceShelf).not.toHaveBeenCalled();
  });

  it('replaces the shelf with de-duplicated known ids in order', async () => {
    const repository = {
      bookIdsExist: vi.fn().mockResolvedValue(new Set([3, 1, 2])),
      replaceShelf: vi.fn().mockResolvedValue(undefined),
    };
    const service = makeService(repository);
    await service.updateMyShelf(7, [3, 1, 2]);
    expect(repository.replaceShelf).toHaveBeenCalledWith(7, [3, 1, 2]);
  });

  it('maps shelf rows with normalized progress and empty titles', async () => {
    const repository = {
      getShelf: vi.fn().mockResolvedValue([
        { bookId: 1, title: 'Book', hasCover: true, rating: 4, progressPercent: 87.6, position: 0 },
        { bookId: 2, title: null, hasCover: false, rating: null, progressPercent: null, position: 1 },
      ]),
    };
    const service = makeService(repository);
    await expect(service.getMyShelf(1)).resolves.toEqual([
      { bookId: 1, title: 'Book', hasCover: true, rating: 4, progressPercent: 88 },
      { bookId: 2, title: '', hasCover: false, rating: null, progressPercent: null },
    ]);
  });

  it('throws NotFound for a public shelf whose owner is gone', async () => {
    const repository = { getUserPublicInfo: vi.fn().mockResolvedValue(undefined) };
    const service = makeService(repository);
    await expect(service.getPublicShelf(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides users who never curated a book (empty shelf is not a public page)', async () => {
    const repository = {
      getUserPublicInfo: vi.fn().mockResolvedValue({ id: 5, username: 'reader', name: 'Reader' }),
      getShelf: vi.fn().mockResolvedValue([]),
    };
    const service = makeService(repository);
    await expect(service.getPublicShelf(5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns owner info and mapped books for the public page', async () => {
    const repository = {
      getUserPublicInfo: vi.fn().mockResolvedValue({ id: 5, username: 'reader', name: 'Reader' }),
      getShelf: vi.fn().mockResolvedValue([{ bookId: 1, title: 'Book', hasCover: true, rating: null, progressPercent: 50, position: 0 }]),
    };
    const service = makeService(repository);
    await expect(service.getPublicShelf(5)).resolves.toEqual({
      userId: 5,
      username: 'reader',
      name: 'Reader',
      books: [{ bookId: 1, title: 'Book', hasCover: true, rating: null, progressPercent: 50 }],
    });
  });

  it('never resolves a cover path for books not on the public shelf', async () => {
    const repository = { isOnShelf: vi.fn().mockResolvedValue(false) };
    const service = makeService(repository);
    await expect(service.getPublicCoverPath(1, 99)).resolves.toBeNull();
  });

  it('returns null when the cover directory is missing or unreadable', async () => {
    const repository = { isOnShelf: vi.fn().mockResolvedValue(true) };
    const service = makeService(repository, '/nonexistent');
    await expect(service.getPublicCoverPath(1, 1)).resolves.toBeNull();
  });
});
