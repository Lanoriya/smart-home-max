-- Cleaning and upkeep of the house: what residents read in «Моя УК».
ALTER TABLE "management_companies" ADD COLUMN "cleaning_info" TEXT DEFAULT 'УК обязана мыть подъезды, подметать двор, вывозить снег зимой и косить траву летом по установленному графику.';
