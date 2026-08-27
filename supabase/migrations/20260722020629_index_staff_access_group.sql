create index "staffuser_access_group_idx"
on "pos"."staff_users" using btree ("access_group_id");;
