import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetryToIssue1791500000000 implements MigrationInterface {
  name = 'AddRetryToIssue1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "issue" ADD "retryStatus" character varying`
    );
    await queryRunner.query(`ALTER TABLE "issue" ADD "retryData" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "retryData"`);
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "retryStatus"`);
  }
}
