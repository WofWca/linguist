import * as IDB from 'idb/with-async-ittr';
import { isEqual } from 'lodash';

import { type } from '../../../lib/types';
import { DeepPartial } from '../../../types/lib';
import { ITranslation, TranslationType } from '../../../types/translation/Translation';

export type ITranslationEntry = {
	translation: ITranslation;
	timestamp: number;
	translator?: string;
};

export const TranslationEntryType = type.intersection([
	type.type({
		translation: TranslationType,
		timestamp: type.number,
	}),
	type.partial({
		translator: type.union([type.string, type.undefined]),
	}),
]);

export const TranslationEntryWithKeyType = type.type({
	key: type.number,
	data: TranslationEntryType,
});

export type ITranslationEntryWithKey = { key: number; data: ITranslationEntry };

export interface DBSchema extends IDB.DBSchema {
	translations: {
		key: number;
		value: ITranslationEntry;
		indexes: {
			originalText: string;
		};
	};
}

type DB = IDB.IDBPDatabase<DBSchema>;

let DBInstance: null | DB = null;
const getDB = async () => {
	const DBName = 'translations';

	if (DBInstance === null) {
		DBInstance = await IDB.openDB<DBSchema>(DBName, 1, {
			upgrade(db) {
				const store = db.createObjectStore('translations', {
					keyPath: 'id',
					autoIncrement: true,
				});

				// `keyPath` with `.` separator: https://w3c.github.io/IndexedDB/#inject-key-into-value
				store.createIndex('originalText', 'translation.originalText', {
					unique: false,
				});
			},
		});
	}

	return DBInstance;
};

export const addEntry = async (entry: ITranslationEntry) => {
	const db = await getDB();
	return db.add('translations', entry);
};

export const deleteEntry = async (entryId: number) => {
	const db = await getDB();
	return db.delete('translations', entryId);
};

export const getEntry = async (entryId: number) => {
	const db = await getDB();
	return db.get('translations', entryId);
};

export const deleteEntries = async (entry: ITranslation) => {
	const db = await getDB();
	const transaction = await db.transaction('translations', 'readwrite');

	// Delete
	const index = await transaction.objectStore('translations').index('originalText');
	for await (const cursor of index.iterate(entry.originalText)) {
		const currentEntry = cursor.value;

		if (
			(Object.keys(entry) as (keyof typeof entry)[]).every(
				(key) => entry[key] === currentEntry.translation[key],
			)
		) {
			await cursor.delete();
		}
	}

	await transaction.done;
};

export const flush = async () => {
	const db = await getDB();
	const transaction = await db.transaction('translations', 'readwrite');

	await transaction.store.delete(IDBKeyRange.lowerBound(0));
	await transaction.done;
};

export const getEntries = async (
	from?: number,
	limit?: number,
	options?: { order: 'desc' | 'asc' },
) => {
	const { order = 'desc' } = options ?? {};

	const db = await getDB();

	const transaction = await db.transaction('translations', 'readonly');

	const entries: ITranslationEntryWithKey[] = [];

	let isJumped = false;
	let counter = 0;
	const startCursor = await transaction.store.openCursor(
		null,
		order === 'desc' ? 'prev' : 'next',
	);
	if (startCursor !== null) {
		for await (const cursor of startCursor) {
			// Jump to specified offset
			if (!isJumped && from !== undefined && from > 0) {
				cursor.advance(from);
				isJumped = true;
				continue;
			}

			// Stop by limit
			if (limit !== undefined && ++counter > limit) break;

			// Add entry
			entries.push({
				key: cursor.primaryKey,
				data: cursor.value,
			});
		}
	}

	await transaction.done;

	return entries;
};

/**
 * Check second object contains all properties of first object with equal values
 */
const isEqualIntersection = (obj1: any, obj2: any): boolean => {
	// Compare primitive values
	if (typeof obj1 !== 'object' && typeof obj2 !== 'object') {
		return obj1 === obj2;
	}

	const xIsArray = Array.isArray(obj1);
	const yIsArray = Array.isArray(obj2);

	// Compare arrays
	if (xIsArray && yIsArray) {
		return isEqual(obj1, obj2);
	} else if (xIsArray || yIsArray) {
		return false;
	}

	// Compare objects
	return Object.keys(obj1).every((key) => isEqualIntersection(obj1[key], obj2[key]));
};

export const findEntry = async (entry: DeepPartial<ITranslationEntry>) => {
	const db = await getDB();
	const transaction = await db.transaction('translations', 'readonly');

	let result: ITranslationEntryWithKey | null = null;

	const originalText = entry?.translation?.originalText;
	if (originalText === undefined) {
		throw new Error('Parameter `originalText` is required to search');
	}

	// TODO: search not only by index
	// Find
	const index = await transaction.objectStore('translations').index('originalText');
	for await (const cursor of index.iterate(originalText)) {
		const currentEntry = cursor.value;

		const isMatch = isEqualIntersection(entry, currentEntry);
		if (isMatch) {
			result = {
				key: cursor.primaryKey,
				data: currentEntry,
			};
			break;
		}
	}

	await transaction.done;

	return result;
};
