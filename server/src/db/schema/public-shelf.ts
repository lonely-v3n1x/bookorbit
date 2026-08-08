import { index, integer, pgTable, serial, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { books } from './books';
import { users } from './auth';

/**
 * A user-curated list of books showcased on their public reading page.
 * Only books present here are ever exposed by the public-shelf endpoints.
 */
export const publicShelfItems = pgTable(
  'public_shelf_items',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('public_shelf_items_user_book_uidx').on(t.userId, t.bookId),
    index('public_shelf_items_user_position_idx').on(t.userId, t.position),
  ],
);

export type PublicShelfItem = typeof publicShelfItems.$inferSelect;
export type NewPublicShelfItem = typeof publicShelfItems.$inferInsert;
