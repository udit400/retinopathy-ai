import asyncio
import os
import tempfile
import unittest

import app as app_module


class DashboardFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        app_module.USERS_FILE = os.path.join(self.temp_dir.name, 'users.json')
        app_module.users = {}
        app_module.sessions = {}
        app_module.otps = {}
        self._seed_users()
        app_module._save_users()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _seed_users(self):
        doctor_one = {
            'user_id': '200001',
            'role': 'doctor',
            'name': 'Dr. Alice',
            'full_name': 'Dr. Alice',
            'mobile': '+910000000001',
            'department': 'Ophthalmology',
            'fees': 1,
            'password': app_module._hash_password('secret1'),
            'created_at': 1,
        }
        doctor_two = {
            'user_id': '200002',
            'role': 'doctor',
            'name': 'Dr. Bob',
            'full_name': 'Dr. Bob',
            'mobile': '+910000000002',
            'department': 'Retina',
            'fees': 1,
            'password': app_module._hash_password('secret2'),
            'created_at': 2,
        }
        patient = {
            'user_id': '300001',
            'role': 'patient',
            'name': 'Patient One',
            'full_name': 'Patient One',
            'mobile': '+910000000003',
            'password': app_module._hash_password('patientpass'),
            'created_at': 3,
        }
        for user in (doctor_one, doctor_two, patient):
            app_module.users[user['user_id']] = app_module._ensure_user_defaults(user)

    def _login(self, user_id, name, password):
        response = asyncio.run(app_module.login_user(app_module.LoginRequest(user_id=user_id, name=name, password=password)))
        return app_module.users[app_module.sessions[response['access_token']]]

    def test_patient_submission_report_and_importance_flow(self):
        patient = self._login('300001', 'Patient One', 'patientpass')
        doctor = self._login('200001', 'Dr. Alice', 'secret1')

        submission_response = asyncio.run(
            app_module.create_patient_submission(
                app_module.PatientSubmissionRequest(doctor_id='200001', note='Blurred vision in left eye'),
                current_user=patient,
            )
        )
        submission_id = submission_response['submission']['submission_id']

        doctor_dashboard = asyncio.run(app_module.doctor_dashboard(current_user=doctor))
        self.assertEqual(doctor_dashboard['patient_messages'][0]['submission_id'], submission_id)

        report_response = asyncio.run(
            app_module.send_doctor_report(
                app_module.DoctorReportRequest(
                    submission_id=submission_id,
                    report_summary='Signs of retinopathy require urgent follow-up.',
                    note='Please arrive fasting for imaging.',
                    treatments=['Retina specialist consultation'],
                    suggestions=['Control blood sugar', 'Book follow-up'],
                    severity='serious',
                ),
                current_user=doctor,
            )
        )
        report = report_response['report']
        self.assertEqual(report['appointment']['appointment_type'], 'serious')

        patient_dashboard = asyncio.run(app_module.patient_dashboard(current_user=patient))
        self.assertEqual(patient_dashboard['reports'][0]['report_summary'], 'Signs of retinopathy require urgent follow-up.')
        self.assertEqual(patient_dashboard['appointments'][0]['appointment_type'], 'serious')

        asyncio.run(
            app_module.mark_report_importance(
                report['report_id'],
                app_module.ImportanceRequest(report_id=report['report_id'], important=True),
                current_user=patient,
            )
        )
        refreshed_dashboard = asyncio.run(app_module.patient_dashboard(current_user=patient))
        self.assertEqual(len(refreshed_dashboard['important_reports']), 1)

    def test_doctor_fee_update_and_chat_flow(self):
        doctor_one = self._login('200001', 'Dr. Alice', 'secret1')
        doctor_two = self._login('200002', 'Dr. Bob', 'secret2')

        fee_response = asyncio.run(
            app_module.update_doctor_fee(app_module.DoctorFeeRequest(fee=450), current_user=doctor_one)
        )
        self.assertEqual(fee_response['doctor']['fees'], 450)

        doctors_response = asyncio.run(app_module.list_doctors(current_user=doctor_one))
        doctors = {doctor['user_id']: doctor for doctor in doctors_response['doctors']}
        self.assertEqual(doctors['200001']['fees'], 450)

        asyncio.run(
            app_module.send_doctor_message(
                app_module.DoctorMessageRequest(doctor_id='200002', message='Please review the serious cases first.'),
                current_user=doctor_one,
            )
        )
        doctor_two_dashboard = asyncio.run(app_module.doctor_dashboard(current_user=doctor_two))
        chats = doctor_two_dashboard['doctor_chats']
        self.assertEqual(chats[0]['messages'][0]['message'], 'Please review the serious cases first.')

    def test_root_page_uses_local_assets(self):
        response = asyncio.run(app_module.read_root())
        html = response.body.decode('utf-8')
        self.assertIn('/static/app.js', html)
        self.assertNotIn('cdnjs.cloudflare.com', html)
        self.assertIn('autocomplete="new-password"', html)
        self.assertIn('autocomplete="one-time-code"', html)


if __name__ == '__main__':
    unittest.main()
