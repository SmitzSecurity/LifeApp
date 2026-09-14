-- Seven-day Trash metadata and atomic content purging. Installation removes no content.
CREATE TABLE life_trash (
 user_id TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL,
 deleted_at TEXT NOT NULL, purged_at TEXT, record_version INTEGER,
 PRIMARY KEY(user_id,kind,record_id)
);
--> statement-breakpoint
CREATE INDEX life_trash_expiry ON life_trash(purged_at,deleted_at);
--> statement-breakpoint
CREATE TRIGGER life_trash_resources_insert AFTER INSERT ON life_resources BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,NEW.kind,NEW.resource_id,NEW.updated_at,NULL
 WHERE NEW.kind IN ('transaction','workout','cardio','workout-note') AND json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND purged_at IS NULL AND COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0;
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,json_extract(NEW.payload,'$.target'),json_extract(NEW.payload,'$.id'),NEW.updated_at,NULL
 WHERE NEW.kind='visibility' AND json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE NEW.kind='visibility' AND user_id=NEW.user_id AND kind=json_extract(NEW.payload,'$.target') AND record_id=json_extract(NEW.payload,'$.id') AND purged_at IS NULL AND json_extract(NEW.payload,'$.deleted')=0;
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,'recurring',NEW.resource_id||':'||json_extract(value,'$.id'),NEW.updated_at,NULL FROM json_each(CASE WHEN NEW.kind='budget' THEN NEW.payload ELSE '{}' END,'$.recurring') WHERE json_extract(value,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE NEW.kind='budget' AND user_id=NEW.user_id AND kind='recurring' AND substr(record_id,1,8)=NEW.resource_id||':' AND purged_at IS NULL AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') WHERE record_id=NEW.resource_id||':'||json_extract(value,'$.id') AND json_extract(value,'$.deleted')=1);
END;
--> statement-breakpoint
CREATE TRIGGER life_trash_entries_insert AFTER INSERT ON life_entries BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,'entry',NEW.entry_date,NEW.updated_at,NULL WHERE json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND (purged_at IS NULL OR NEW.version>record_version) AND COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0;
END;
--> statement-breakpoint
CREATE TRIGGER life_resources_purged_insert BEFORE INSERT ON life_resources WHEN EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND purged_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Record permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_entries_purged_insert BEFORE INSERT ON life_entries WHEN EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND purged_at IS NOT NULL AND NEW.version<=COALESCE(record_version,9007199254740991)) BEGIN SELECT RAISE(ABORT,'Record permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_recurring_purged_insert BEFORE INSERT ON life_resources WHEN NEW.kind='budget' AND EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') item JOIN life_trash t ON t.user_id=NEW.user_id AND t.kind='recurring' AND t.record_id=NEW.resource_id||':'||json_extract(item.value,'$.id') WHERE t.purged_at IS NOT NULL AND (COALESCE(json_extract(item.value,'$.purged'),0)<>1 OR json_extract(item.value,'$.deleted')<>1 OR json_extract(item.value,'$.active')<>0)) BEGIN SELECT RAISE(ABORT,'Monthly item permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_trash_resources_update AFTER UPDATE ON life_resources BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,NEW.kind,NEW.resource_id,NEW.updated_at,NULL
 WHERE NEW.kind IN ('transaction','workout','cardio','workout-note') AND json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND purged_at IS NULL AND COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0;
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,json_extract(NEW.payload,'$.target'),json_extract(NEW.payload,'$.id'),NEW.updated_at,NULL
 WHERE NEW.kind='visibility' AND json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE NEW.kind='visibility' AND user_id=NEW.user_id AND kind=json_extract(NEW.payload,'$.target') AND record_id=json_extract(NEW.payload,'$.id') AND purged_at IS NULL AND json_extract(NEW.payload,'$.deleted')=0;
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,'recurring',NEW.resource_id||':'||json_extract(value,'$.id'),NEW.updated_at,NULL FROM json_each(CASE WHEN NEW.kind='budget' THEN NEW.payload ELSE '{}' END,'$.recurring') WHERE json_extract(value,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE NEW.kind='budget' AND user_id=NEW.user_id AND kind='recurring' AND substr(record_id,1,8)=NEW.resource_id||':' AND purged_at IS NULL AND NOT EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') WHERE record_id=NEW.resource_id||':'||json_extract(value,'$.id') AND json_extract(value,'$.deleted')=1);
END;
--> statement-breakpoint
CREATE TRIGGER life_trash_entries_update AFTER UPDATE ON life_entries BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT NEW.user_id,'entry',NEW.entry_date,NEW.updated_at,NULL WHERE json_extract(NEW.payload,'$.deleted')=1 ON CONFLICT DO NOTHING;
 DELETE FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND (purged_at IS NULL OR NEW.version>record_version) AND COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0;
END;
--> statement-breakpoint
CREATE TRIGGER life_resources_purged_update BEFORE UPDATE ON life_resources WHEN EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND purged_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Record permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_entries_purged_update BEFORE UPDATE ON life_entries WHEN EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND purged_at IS NOT NULL AND NEW.version<=COALESCE(record_version,9007199254740991)) BEGIN SELECT RAISE(ABORT,'Record permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_recurring_purged_update BEFORE UPDATE ON life_resources WHEN NEW.kind='budget' AND EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') item JOIN life_trash t ON t.user_id=NEW.user_id AND t.kind='recurring' AND t.record_id=NEW.resource_id||':'||json_extract(item.value,'$.id') WHERE t.purged_at IS NOT NULL AND (COALESCE(json_extract(item.value,'$.purged'),0)<>1 OR json_extract(item.value,'$.deleted')<>1 OR json_extract(item.value,'$.active')<>0)) BEGIN SELECT RAISE(ABORT,'Monthly item permanently deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_trash_purge AFTER UPDATE OF purged_at ON life_trash WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL BEGIN
 UPDATE life_trash SET record_version=(SELECT version+1 FROM life_entries WHERE user_id=NEW.user_id AND entry_date=NEW.record_id) WHERE NEW.kind='entry' AND user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.record_id;
 DELETE FROM life_entries WHERE NEW.kind='entry' AND user_id=NEW.user_id AND entry_date=NEW.record_id;
 DELETE FROM life_resources WHERE NEW.kind IN ('transaction','workout','cardio','workout-note') AND user_id=NEW.user_id AND kind=NEW.kind AND resource_id=NEW.record_id;
 UPDATE life_ai_reviews SET report_text=NULL,critique='',provider_id=NULL,input_snapshot='{"purged":true}' WHERE NEW.kind='analysis' AND user_id=NEW.user_id AND request_id=NEW.record_id;
 UPDATE life_ai_reviews SET input_snapshot=json_set(input_snapshot,'$.previousReview',NULL,'$.previousReviewExcluded',json('true')) WHERE NEW.kind='analysis' AND user_id=NEW.user_id AND predecessor_id=NEW.record_id AND COALESCE(json_extract(input_snapshot,'$.purged'),0)=0;
 UPDATE life_routine_builds SET result_json=NULL,provider_id=NULL,input_snapshot=(CASE WHEN json_extract(input_snapshot,'$.recoveryOf') IS NULL THEN '{"purged":true}' ELSE json_object('purged',json('true'),'recoveryOf',json_extract(input_snapshot,'$.recoveryOf')) END) WHERE NEW.kind='build' AND user_id=NEW.user_id AND request_id=NEW.record_id;
 UPDATE life_resources SET payload=json_set(payload,'$.recurring['||(SELECT key FROM json_each(payload,'$.recurring') WHERE json_extract(value,'$.id')=substr(NEW.record_id,9))||']',json_object('id',substr(NEW.record_id,9),'title','Deleted item','kind',(SELECT json_extract(value,'$.kind') FROM json_each(payload,'$.recurring') WHERE json_extract(value,'$.id')=substr(NEW.record_id,9)),'categoryId',(SELECT json_extract(value,'$.categoryId') FROM json_each(payload,'$.recurring') WHERE json_extract(value,'$.id')=substr(NEW.record_id,9)),'amountCents',1,'day',1,'frequency','monthly-day','week','first','weekday',1,'variable',json('false'),'active',json('false'),'deleted',json('true'),'purged',json('true'))),version=version+1,updated_at=NEW.purged_at WHERE NEW.kind='recurring' AND user_id=NEW.user_id AND kind='budget' AND resource_id=substr(NEW.record_id,1,7);
 UPDATE life_email_outbox SET state='cancelled',finished_at=NEW.purged_at,error_code='analysis_deleted' WHERE NEW.kind='analysis' AND user_id=NEW.user_id AND request_id=NEW.record_id AND state IN ('pending','retry');
END;
--> statement-breakpoint
CREATE TRIGGER life_trash_account_delete BEFORE INSERT ON life_account_deletions BEGIN DELETE FROM life_trash WHERE user_id=NEW.user_id; END;
--> statement-breakpoint
INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT user_id,'entry',entry_date,updated_at,NULL FROM life_entries WHERE json_extract(payload,'$.deleted')=1;
--> statement-breakpoint
INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT user_id,kind,resource_id,updated_at,NULL FROM life_resources WHERE kind IN ('transaction','workout','cardio','workout-note') AND json_extract(payload,'$.deleted')=1;
--> statement-breakpoint
INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT user_id,json_extract(payload,'$.target'),json_extract(payload,'$.id'),updated_at,NULL FROM life_resources WHERE kind='visibility' AND json_extract(payload,'$.deleted')=1;
--> statement-breakpoint
INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT r.user_id,'recurring',r.resource_id||':'||json_extract(j.value,'$.id'),r.updated_at,NULL FROM life_resources r,json_each(CASE WHEN r.kind='budget' THEN r.payload ELSE '{}' END,'$.recurring') j WHERE json_extract(j.value,'$.deleted')=1;

--> statement-breakpoint
CREATE TRIGGER life_analysis_replace AFTER UPDATE OF status ON life_ai_reviews WHEN NEW.status='complete' AND OLD.status<>'complete' AND NEW.report_text IS NOT NULL BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT user_id,'analysis',request_id,NEW.finished_at,NULL FROM life_ai_reviews WHERE user_id=NEW.user_id AND cadence=NEW.cadence AND entry_date=NEW.entry_date AND revision<NEW.revision AND status='complete' ON CONFLICT DO NOTHING;
 UPDATE life_trash SET purged_at=NEW.finished_at WHERE user_id=NEW.user_id AND kind='analysis' AND purged_at IS NULL AND record_id IN (SELECT request_id FROM life_ai_reviews WHERE user_id=NEW.user_id AND cadence=NEW.cadence AND entry_date=NEW.entry_date AND revision<NEW.revision AND status='complete');
END;
--> statement-breakpoint
CREATE TRIGGER life_training_replace AFTER UPDATE OF status ON life_routine_builds WHEN NEW.request_id LIKE 'training:%' AND NEW.status='complete' AND OLD.status<>'complete' AND NEW.result_json IS NOT NULL BEGIN
 INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) SELECT user_id,'build',request_id,NEW.finished_at,NULL FROM life_routine_builds WHERE user_id=NEW.user_id AND request_id LIKE 'training:%' AND request_id<>NEW.request_id AND created_at<=NEW.created_at AND status='complete' AND json_extract(input_snapshot,'$.training.from')=json_extract(NEW.input_snapshot,'$.training.from') ON CONFLICT DO NOTHING;
 UPDATE life_trash SET purged_at=NEW.finished_at WHERE user_id=NEW.user_id AND kind='build' AND purged_at IS NULL AND record_id IN (SELECT request_id FROM life_routine_builds WHERE user_id=NEW.user_id AND request_id LIKE 'training:%' AND request_id<>NEW.request_id AND created_at<=NEW.created_at AND status='complete' AND json_extract(input_snapshot,'$.training.from')=json_extract(NEW.input_snapshot,'$.training.from'));
END;

--> statement-breakpoint
CREATE TRIGGER life_resources_restore_expired_insert BEFORE INSERT ON life_resources WHEN COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;

--> statement-breakpoint
CREATE TRIGGER life_entries_restore_expired_insert BEFORE INSERT ON life_entries WHEN COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND purged_at IS NULL AND deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;

--> statement-breakpoint
CREATE TRIGGER life_visibility_restore_expired_insert BEFORE INSERT ON life_resources WHEN NEW.kind='visibility' AND json_extract(NEW.payload,'$.deleted')=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=json_extract(NEW.payload,'$.target') AND record_id=json_extract(NEW.payload,'$.id') AND (purged_at IS NOT NULL OR deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days'))) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;
--> statement-breakpoint
CREATE TRIGGER life_recurring_restore_expired_insert BEFORE INSERT ON life_resources WHEN NEW.kind='budget' AND EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') item JOIN life_trash t ON t.user_id=NEW.user_id AND t.kind='recurring' AND t.record_id=NEW.resource_id||':'||json_extract(item.value,'$.id') WHERE COALESCE(json_extract(item.value,'$.deleted'),0)=0 AND t.deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;

--> statement-breakpoint
CREATE TRIGGER life_resources_restore_expired_update BEFORE UPDATE ON life_resources WHEN COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=NEW.kind AND record_id=NEW.resource_id AND deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;

--> statement-breakpoint
CREATE TRIGGER life_entries_restore_expired_update BEFORE UPDATE ON life_entries WHEN COALESCE(json_extract(NEW.payload,'$.deleted'),0)=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind='entry' AND record_id=NEW.entry_date AND purged_at IS NULL AND deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;

--> statement-breakpoint
CREATE TRIGGER life_visibility_restore_expired_update BEFORE UPDATE ON life_resources WHEN NEW.kind='visibility' AND json_extract(NEW.payload,'$.deleted')=0 AND EXISTS(SELECT 1 FROM life_trash WHERE user_id=NEW.user_id AND kind=json_extract(NEW.payload,'$.target') AND record_id=json_extract(NEW.payload,'$.id') AND (purged_at IS NOT NULL OR deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days'))) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;
--> statement-breakpoint
CREATE TRIGGER life_recurring_restore_expired_update BEFORE UPDATE ON life_resources WHEN NEW.kind='budget' AND EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.recurring') item JOIN life_trash t ON t.user_id=NEW.user_id AND t.kind='recurring' AND t.record_id=NEW.resource_id||':'||json_extract(item.value,'$.id') WHERE COALESCE(json_extract(item.value,'$.deleted'),0)=0 AND t.deleted_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'-7 days')) BEGIN SELECT RAISE(ABORT,'Restore period ended'); END;
