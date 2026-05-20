drop policy "Admin full access loyalty_points" on "public"."loyalty_points";

drop policy "Customers read own loyalty_points" on "public"."loyalty_points";

drop policy "Admin full access loyalty_settings" on "public"."loyalty_settings";

drop policy "Anyone can read loyalty_settings" on "public"."loyalty_settings";

drop policy "Admin full access loyalty_transactions" on "public"."loyalty_transactions";

drop policy "Customers read own loyalty_transactions" on "public"."loyalty_transactions";

drop policy "Admin full access referrals" on "public"."referrals";

drop policy "Customers insert own referrals" on "public"."referrals";

drop policy "Customers read own referrals" on "public"."referrals";

drop policy "public_insert_pending_customers" on "public"."pending_customers";

drop policy "public_select_pending_customers" on "public"."pending_customers";

drop policy "public_update_pending_customers" on "public"."pending_customers";

revoke delete on table "public"."loyalty_points" from "anon";

revoke insert on table "public"."loyalty_points" from "anon";

revoke references on table "public"."loyalty_points" from "anon";

revoke select on table "public"."loyalty_points" from "anon";

revoke trigger on table "public"."loyalty_points" from "anon";

revoke truncate on table "public"."loyalty_points" from "anon";

revoke update on table "public"."loyalty_points" from "anon";

revoke delete on table "public"."loyalty_points" from "authenticated";

revoke insert on table "public"."loyalty_points" from "authenticated";

revoke references on table "public"."loyalty_points" from "authenticated";

revoke select on table "public"."loyalty_points" from "authenticated";

revoke trigger on table "public"."loyalty_points" from "authenticated";

revoke truncate on table "public"."loyalty_points" from "authenticated";

revoke update on table "public"."loyalty_points" from "authenticated";

revoke delete on table "public"."loyalty_points" from "service_role";

revoke insert on table "public"."loyalty_points" from "service_role";

revoke references on table "public"."loyalty_points" from "service_role";

revoke select on table "public"."loyalty_points" from "service_role";

revoke trigger on table "public"."loyalty_points" from "service_role";

revoke truncate on table "public"."loyalty_points" from "service_role";

revoke update on table "public"."loyalty_points" from "service_role";

revoke delete on table "public"."loyalty_settings" from "anon";

revoke insert on table "public"."loyalty_settings" from "anon";

revoke references on table "public"."loyalty_settings" from "anon";

revoke select on table "public"."loyalty_settings" from "anon";

revoke trigger on table "public"."loyalty_settings" from "anon";

revoke truncate on table "public"."loyalty_settings" from "anon";

revoke update on table "public"."loyalty_settings" from "anon";

revoke delete on table "public"."loyalty_settings" from "authenticated";

revoke insert on table "public"."loyalty_settings" from "authenticated";

revoke references on table "public"."loyalty_settings" from "authenticated";

revoke select on table "public"."loyalty_settings" from "authenticated";

revoke trigger on table "public"."loyalty_settings" from "authenticated";

revoke truncate on table "public"."loyalty_settings" from "authenticated";

revoke update on table "public"."loyalty_settings" from "authenticated";

revoke delete on table "public"."loyalty_settings" from "service_role";

revoke insert on table "public"."loyalty_settings" from "service_role";

revoke references on table "public"."loyalty_settings" from "service_role";

revoke select on table "public"."loyalty_settings" from "service_role";

revoke trigger on table "public"."loyalty_settings" from "service_role";

revoke truncate on table "public"."loyalty_settings" from "service_role";

revoke update on table "public"."loyalty_settings" from "service_role";

revoke delete on table "public"."loyalty_transactions" from "anon";

revoke insert on table "public"."loyalty_transactions" from "anon";

revoke references on table "public"."loyalty_transactions" from "anon";

revoke select on table "public"."loyalty_transactions" from "anon";

revoke trigger on table "public"."loyalty_transactions" from "anon";

revoke truncate on table "public"."loyalty_transactions" from "anon";

revoke update on table "public"."loyalty_transactions" from "anon";

revoke delete on table "public"."loyalty_transactions" from "authenticated";

revoke insert on table "public"."loyalty_transactions" from "authenticated";

revoke references on table "public"."loyalty_transactions" from "authenticated";

revoke select on table "public"."loyalty_transactions" from "authenticated";

revoke trigger on table "public"."loyalty_transactions" from "authenticated";

revoke truncate on table "public"."loyalty_transactions" from "authenticated";

revoke update on table "public"."loyalty_transactions" from "authenticated";

revoke delete on table "public"."loyalty_transactions" from "service_role";

revoke insert on table "public"."loyalty_transactions" from "service_role";

revoke references on table "public"."loyalty_transactions" from "service_role";

revoke select on table "public"."loyalty_transactions" from "service_role";

revoke trigger on table "public"."loyalty_transactions" from "service_role";

revoke truncate on table "public"."loyalty_transactions" from "service_role";

revoke update on table "public"."loyalty_transactions" from "service_role";

revoke delete on table "public"."referrals" from "anon";

revoke insert on table "public"."referrals" from "anon";

revoke references on table "public"."referrals" from "anon";

revoke select on table "public"."referrals" from "anon";

revoke trigger on table "public"."referrals" from "anon";

revoke truncate on table "public"."referrals" from "anon";

revoke update on table "public"."referrals" from "anon";

revoke delete on table "public"."referrals" from "authenticated";

revoke insert on table "public"."referrals" from "authenticated";

revoke references on table "public"."referrals" from "authenticated";

revoke select on table "public"."referrals" from "authenticated";

revoke trigger on table "public"."referrals" from "authenticated";

revoke truncate on table "public"."referrals" from "authenticated";

revoke update on table "public"."referrals" from "authenticated";

revoke delete on table "public"."referrals" from "service_role";

revoke insert on table "public"."referrals" from "service_role";

revoke references on table "public"."referrals" from "service_role";

revoke select on table "public"."referrals" from "service_role";

revoke trigger on table "public"."referrals" from "service_role";

revoke truncate on table "public"."referrals" from "service_role";

revoke update on table "public"."referrals" from "service_role";

alter table "public"."loyalty_points" drop constraint "loyalty_points_customer_id_fkey";

alter table "public"."loyalty_points" drop constraint "loyalty_points_customer_id_key";

alter table "public"."loyalty_points" drop constraint "loyalty_points_points_balance_check";

alter table "public"."loyalty_transactions" drop constraint "loyalty_transactions_booking_id_fkey";

alter table "public"."loyalty_transactions" drop constraint "loyalty_transactions_customer_id_fkey";

alter table "public"."loyalty_transactions" drop constraint "loyalty_transactions_transaction_type_check";

alter table "public"."referrals" drop constraint "referrals_completed_booking_id_fkey";

alter table "public"."referrals" drop constraint "referrals_referee_customer_id_fkey";

alter table "public"."referrals" drop constraint "referrals_referral_code_key";

alter table "public"."referrals" drop constraint "referrals_referrer_customer_id_fkey";

alter table "public"."referrals" drop constraint "referrals_status_check";

alter table "public"."loyalty_points" drop constraint "loyalty_points_pkey";

alter table "public"."loyalty_settings" drop constraint "loyalty_settings_pkey";

alter table "public"."loyalty_transactions" drop constraint "loyalty_transactions_pkey";

alter table "public"."referrals" drop constraint "referrals_pkey";

drop index if exists "public"."loyalty_points_customer_id_key";

drop index if exists "public"."loyalty_points_pkey";

drop index if exists "public"."loyalty_settings_pkey";

drop index if exists "public"."loyalty_transactions_earned_booking_unique";

drop index if exists "public"."loyalty_transactions_pkey";

drop index if exists "public"."referrals_pkey";

drop index if exists "public"."referrals_referral_code_idx";

drop index if exists "public"."referrals_referral_code_key";

drop index if exists "public"."referrals_referrer_customer_id_idx";

drop table "public"."loyalty_points";

drop table "public"."loyalty_settings";

drop table "public"."loyalty_transactions";

drop table "public"."referrals";


  create policy "public_insert_pending_customers"
  on "public"."pending_customers"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "public_select_pending_customers"
  on "public"."pending_customers"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public_update_pending_customers"
  on "public"."pending_customers"
  as permissive
  for update
  to anon, authenticated
using (true)
with check (true);


CREATE TRIGGER on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleted_users();


  create policy "Admin write resource-covers"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-covers'::text));



  create policy "Admin write resource-files"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-files'::text));



  create policy "Admin write resource-pdfs"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-pdfs'::text));



  create policy "Public read resource-covers"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-covers'::text));



  create policy "Public read resource-files"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-files'::text));



  create policy "Public read resource-pdfs"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-pdfs'::text));



  create policy "verification_documents_admin_all"
  on "storage"."objects"
  as permissive
  for all
  to authenticated
using (((bucket_id = 'verification-documents'::text) AND public.is_admin()))
with check (((bucket_id = 'verification-documents'::text) AND public.is_admin()));



  create policy "verification_documents_insert"
  on "storage"."objects"
  as permissive
  for insert
  to anon, authenticated
with check (((bucket_id = 'verification-documents'::text) AND ((storage.foldername(name))[1] = 'customers'::text) AND ((storage.foldername(name))[3] = 'verification'::text) AND (((storage.foldername(name))[2] ~~ 'unassigned-%'::text) OR public.is_admin() OR ((auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[2] IN ( SELECT (customers.id)::text AS id
   FROM public.customers
  WHERE (customers.user_id = auth.uid())))))));



  create policy "verification_documents_public_read"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'verification-documents'::text));



  create policy "verification_documents_update"
  on "storage"."objects"
  as permissive
  for update
  to anon, authenticated
using (((bucket_id = 'verification-documents'::text) AND ((storage.foldername(name))[1] = 'customers'::text) AND ((storage.foldername(name))[3] = 'verification'::text) AND (((storage.foldername(name))[2] ~~ 'unassigned-%'::text) OR public.is_admin() OR ((auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[2] IN ( SELECT (customers.id)::text AS id
   FROM public.customers
  WHERE (customers.user_id = auth.uid())))))))
with check (((bucket_id = 'verification-documents'::text) AND ((storage.foldername(name))[1] = 'customers'::text) AND ((storage.foldername(name))[3] = 'verification'::text) AND (((storage.foldername(name))[2] ~~ 'unassigned-%'::text) OR public.is_admin() OR ((auth.role() = 'authenticated'::text) AND ((storage.foldername(name))[2] IN ( SELECT (customers.id)::text AS id
   FROM public.customers
  WHERE (customers.user_id = auth.uid())))))));



