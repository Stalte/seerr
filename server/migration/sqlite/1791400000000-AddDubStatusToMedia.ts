import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDubStatusToMedia1791400000000 implements MigrationInterface {
  name = 'AddDubStatusToMedia1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Adding a column with a constant default needs no table rebuild, so
    // existing rows are untouched and start out as UNKNOWN (1)
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "statusDub" integer NOT NULL DEFAULT (1)`
    );
    await queryRunner.query(
      `ALTER TABLE "season" ADD COLUMN "statusDub" integer NOT NULL DEFAULT (1)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "season" DROP COLUMN "statusDub"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "statusDub"`);
  }
}
