import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnimeAudioToMediaRequest1791300000000 implements MigrationInterface {
  name = 'AddAnimeAudioToMediaRequest1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "animeAudio" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "animeAudio"`
    );
  }
}
