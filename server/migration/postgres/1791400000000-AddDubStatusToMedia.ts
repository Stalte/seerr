import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDubStatusToMedia1791400000000 implements MigrationInterface {
  name = 'AddDubStatusToMedia1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" ADD "statusDub" integer NOT NULL DEFAULT '1'`
    );
    await queryRunner.query(
      `ALTER TABLE "season" ADD "statusDub" integer NOT NULL DEFAULT '1'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "season" DROP COLUMN "statusDub"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "statusDub"`);
  }
}
