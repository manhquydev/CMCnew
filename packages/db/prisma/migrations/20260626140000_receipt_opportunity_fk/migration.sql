-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
