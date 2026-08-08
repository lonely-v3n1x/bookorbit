import { readdir } from 'fs/promises';
import { join } from 'path';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { bookCoverDirPath, findPreferredBookCoverFileName } from '../../common/book-cover-storage';
import { PublicShelfRepository } from './public-shelf.repository';

@Injectable()
export class PublicShelfService {
  private readonly appDataPath: string;

  constructor(
    private readonly repository: PublicShelfRepository,
    config: ConfigService,
  ) {
    this.appDataPath = config.get<string>('storage.appDataPath')!;
  }

  /** The authenticated user's curated shelf with display details. */
  async getMyShelf(userId: number) {
    return this.mapShelf(await this.repository.getShelf(userId));
  }

  /** Replace the authenticated user's curated shelf with an ordered list of books. */
  async updateMyShelf(userId: number, bookIds: number[]): Promise<void> {
    const uniqueIds = [...new Set(bookIds)];
    if (uniqueIds.length !== bookIds.length) {
      throw new BadRequestException({ message: 'Duplicate book ids are not allowed', errorCode: 'PUBLIC_SHELF_DUPLICATE' });
    }
    if (uniqueIds.length > 100) {
      throw new BadRequestException({ message: 'A public shelf can hold at most 100 books', errorCode: 'PUBLIC_SHELF_TOO_LARGE' });
    }
    const existing = await this.repository.bookIdsExist(uniqueIds);
    const missing = uniqueIds.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({ message: `Unknown book ids: ${missing.join(', ')}`, errorCode: 'PUBLIC_SHELF_UNKNOWN_BOOK' });
    }
    await this.repository.replaceShelf(userId, uniqueIds);
  }

  /**
   * Public page payload: owner profile + showcased books (no auth required).
   * A user only gets a public page once they have curated at least one book,
   * so probing /public/:userId never reveals accounts that never opted in.
   */
  async getPublicShelf(userId: number) {
    const owner = await this.repository.getUserPublicInfo(userId);
    if (!owner) throw new NotFoundException('User not found');
    const books = this.mapShelf(await this.repository.getShelf(userId));
    if (books.length === 0) throw new NotFoundException('User has no public page');
    return { userId: owner.id, username: owner.username, name: owner.name, books };
  }

  /**
   * Cover file path for a public-shelf book. Only returns a path when the book
   * is actually on the user's public shelf, so covers are never leaked for
   * books the owner did not choose to showcase.
   */
  async getPublicCoverPath(userId: number, bookId: number): Promise<string | null> {
    if (!(await this.repository.isOnShelf(userId, bookId))) return null;
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      return cover ? join(dir, cover) : null;
    } catch {
      return null;
    }
  }

  private mapShelf(
    rows: Array<{
      bookId: number;
      title: string | null;
      hasCover: boolean;
      rating: number | null;
      progressPercent: number | null;
      position: number;
    }>,
  ) {
    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title ?? '',
      hasCover: row.hasCover,
      rating: row.rating,
      progressPercent: row.progressPercent == null ? null : Math.round(row.progressPercent),
    }));
  }
}
