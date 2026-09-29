-- The first prototype seeded illustrative numbers such as 00-00-00 and 99-99-99.
-- They must not be shown to residents as actual emergency contacts. Real contacts
-- are entered and maintained by a dispatcher in the admin panel.
DELETE FROM "emergency_services"
WHERE ("name" = 'Аварийный диспетчер' AND "phone" = '+7 (3452) 00-00-00')
   OR ("name" = 'Тюмень Водоканал' AND "phone" = '+7 (3452) 54-09-22')
   OR ("name" = 'Лифтовая служба' AND "phone" = '+7 (3452) 22-41-24')
   OR ("name" = 'Электрик' AND "phone" = '+7 (3452) 99-99-99')
   OR ("name" = 'Сантехник' AND "phone" = '+7 (3452) 99-99-99');
