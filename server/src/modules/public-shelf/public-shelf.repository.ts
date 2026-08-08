import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class PublicShelfRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The current user's curated shelf, ordered by position, with title/rating/progress. */
  async getShelf(userId: number) {
    return this.db
      .select({
        bookId: schema.publicShelfItems.bookId,
        title: schema.bookMetadata.title,
        hasCover: sql<boolean>`${schema.bookMetadata.coverSource} is not null`,
        rating: schema.userBookRatings.rating,
        progressPercent: sql<number | null>`max(${schema.readingProgress.percentage})`,
        position: schema.publicShelfItems.position,
      })
      .from(schema.publicShelfItems)
      .innerJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.publicShelfItems.bookId))
      .leftJoin(
        schema.userBookRatings,
        and(eq(schema.userBookRatings.userId, userId), eq(schema.userBookRatings.bookId, schema.publicShelfItems.bookId)),
      )
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.bookId, schema.publicShelfItems.bookId))
      .leftJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .where(eq(schema.publicShelfItems.userId, userId))
      .groupBy(
        schema.publicShelfItems.bookId,
        schema.bookMetadata.title,
        schema.bookMetadata.coverSource,
        schema.userBookRatings.rating,
        schema.publicShelfItems.position,
      )
      .orderBy(schema.publicShelfItems.position);
  }

  /** Replace the whole shelf with an ordered list of book ids. */
  async replaceShelf(userId: number, bookIds: number[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.publicShelfItems).where(eq(schema.publicShelfItems.userId, userId));
      if (bookIds.length > 0) {
        await tx.insert(schema.publicShelfItems).values(bookIds.map((bookId, position) => ({ userId, bookId, position })));
      }
    });
  }

  /** True when the book is on the user's public shelf (gate for public cover serving). */
  async isOnShelf(userId: number, bookId: number): Promise<boolean> {
    const row = await this.db.query.publicShelfItems.findFirst({
      columns: { id: true },
      where: and(eq(schema.publicShelfItems.userId, userId), eq(schema.publicShelfItems.bookId, bookId)),
    });
    return row !== undefined;
  }

  /** Public profile info for a shelf owner. */
  async getUserPublicInfo(userId: number) {
    return this.db.query.users.findFirst({
      columns: { id: true, username: true, name: true },
      where: eq(schema.users.id, userId),
    });
  }

  /** Whether all given book ids exist (prevents dangling shelf rows). */
  async bookIdsExist(bookIds: number[]): Promise<Set<number>> {
    if (bookIds.length === 0) return new Set();
    const rows = await this.db.select({ id: schema.books.id }).from(schema.books).where(inArray(schema.books.id, bookIds));
    return new Set(rows.map((r) => r.id));
  }
}
