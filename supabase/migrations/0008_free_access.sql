-- Free access: remove API credit caps on existing organizations

UPDATE organizations
SET api_credit_limit = 9999999
WHERE api_credit_limit IS NULL OR api_credit_limit < 9999999;
