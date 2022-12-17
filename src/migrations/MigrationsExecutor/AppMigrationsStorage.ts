import { TypeOf } from 'io-ts';
import browser from 'webextension-polyfill';

import { decodeStruct, type } from '../../lib/types';
import { migrationsForMigrationsStorage } from './MigrationsStorage.migrations';
import { MigrationsMap, MigrationsStorage } from './MigrationsStorage';

const migrationsStructure = type.type({
	version: type.number,
	dataVersions: type.record(type.string, type.number),
});

type MigrationsData = TypeOf<typeof migrationsStructure>;

export class AppMigrationsStorage implements MigrationsStorage {
	private readonly storageName = 'migrationsInfo';

	public prepareStorage = async () => {
		const latestVersion = migrationsForMigrationsStorage.version;
		const initData = {
			version: latestVersion,
			dataVersions: {},
		};

		const { isMigrationsStorageExist, migrationsStorageVersion } =
			await this.getMigrationsMetaInfo();

		// Init storage
		if (!isMigrationsStorageExist) {
			// Init migrations storage
			await this.setMigrationsData(initData);
			return;
		}

		// Migrate storage data
		if (latestVersion > migrationsStorageVersion) {
			await migrationsForMigrationsStorage.migrate(
				migrationsStorageVersion,
				latestVersion,
			);

			const currentData = await this.getMigrationsData();
			await this.setMigrationsData({
				...(currentData || initData),
				version: latestVersion,
			});
		}
	};

	private getMigrationsMetaInfo = async () => {
		const storage = await browser.storage.local.get(this.storageName);
		const isMigrationsStorageExist =
			this.storageName in storage && storage[this.storageName] !== undefined;
		const migrationsStorageVersion =
			isMigrationsStorageExist &&
			typeof storage[this.storageName].version === 'number'
				? storage[this.storageName].version
				: 0;

		return {
			isMigrationsStorageExist,
			migrationsStorageVersion,
		};
	};

	private getMigrationsData = async () => {
		const { [this.storageName]: rawData } = await browser.storage.local.get(
			this.storageName,
		);

		// Verify data
		const codec = decodeStruct(migrationsStructure, rawData);
		if (codec.errors !== null) return null;

		return codec.data;
	};

	private setMigrationsData = async (migrationsData: MigrationsData) => {
		await browser.storage.local.set({ [this.storageName]: migrationsData });
	};

	public getMigrationsVersions = async () => {
		const migrationsData = await this.getMigrationsData();
		return migrationsData ? migrationsData.dataVersions : {};
	};

	public setMigrationsVersions = async (migrationsVersions: MigrationsMap) => {
		const migrationsData = await this.getMigrationsData();

		if (migrationsData === null) {
			throw new TypeError('Migrations data are empty');
		}

		await this.setMigrationsData({
			...migrationsData,
			dataVersions: migrationsVersions,
		});
	};
}
