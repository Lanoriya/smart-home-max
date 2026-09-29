INSERT INTO "emergency_services" ("name", "phone", "description", "updated_at")
SELECT 'Аварийный диспетчер', '+7 (3452) 00-00-00', 'Круглосуточно принимает аварийные обращения по общему имуществу дома.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "emergency_services" WHERE "name" = 'Аварийный диспетчер');

INSERT INTO "emergency_services" ("name", "phone", "description", "updated_at")
SELECT 'Тюмень Водоканал', '+7 (3452) 54-09-22', 'Аварии и вопросы водоснабжения и канализации.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "emergency_services" WHERE "name" = 'Тюмень Водоканал');

INSERT INTO "emergency_services" ("name", "phone", "description", "updated_at")
SELECT 'Лифтовая служба', '+7 (3452) 22-41-24', 'Застревание и неисправности лифта.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "emergency_services" WHERE "name" = 'Лифтовая служба');

INSERT INTO "emergency_services" ("name", "phone", "description", "updated_at")
SELECT 'Электрик', '+7 (3452) 99-99-99', 'Аварии электроснабжения и неисправности электрики.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "emergency_services" WHERE "name" = 'Электрик');

INSERT INTO "emergency_services" ("name", "phone", "description", "updated_at")
SELECT 'Сантехник', '+7 (3452) 99-99-99', 'Протечки, аварии водоснабжения и канализации в квартире.', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "emergency_services" WHERE "name" = 'Сантехник');
