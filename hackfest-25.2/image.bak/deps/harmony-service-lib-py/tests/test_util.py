from requests import Session
import unittest
from unittest.mock import patch, MagicMock, mock_open, ANY

from harmony_service_lib import aws
from harmony_service_lib import util
from harmony_service_lib.http import request_context
from harmony_service_lib.message import Variable
from tests.util import config_fixture


class TestDownload(unittest.TestCase):
    def setUp(self):
        self.config = util.config(validate=False)

    @patch('harmony_service_lib.util.get_version')
    @patch('boto3.client')
    @patch('harmony_service_lib.aws.Config')
    def test_s3_download_sets_minimal_user_agent_on_boto_client(self, boto_cfg, client, get_version):
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        cfg = config_fixture()
        boto_cfg_instance = MagicMock()
        boto_cfg.return_value = boto_cfg_instance
        with patch('builtins.open', mock_open()):
            util.download('s3://example/file.txt', 'tmp', access_token='', cfg=cfg)
        boto_cfg.assert_called_with(user_agent_extra=f'harmony (unknown version) harmony-service-lib/{fake_lib_version}')
        client.assert_called_with(service_name='s3', config=boto_cfg_instance, region_name=ANY)

    @patch('harmony_service_lib.util.get_version')
    @patch('boto3.client')
    @patch('harmony_service_lib.aws.Config')
    def test_s3_download_sets_harmony_user_agent_on_boto_client(self, boto_cfg, client, get_version):
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        harmony_user_agt = 'harmony/3.3.3 (harmony-test)'
        cfg = config_fixture(user_agent=harmony_user_agt)
        boto_cfg_instance = MagicMock()
        boto_cfg.return_value = boto_cfg_instance
        with patch('builtins.open', mock_open()):
            util.download('s3://example/file.txt', 'tmp', access_token='', cfg=cfg)
        boto_cfg.assert_called_with(user_agent_extra=f'{harmony_user_agt} harmony-service-lib/{fake_lib_version}')
        client.assert_called_with(service_name='s3', config=boto_cfg_instance, region_name=ANY)

    @patch('harmony_service_lib.util.get_version')
    @patch('boto3.client')
    @patch('harmony_service_lib.aws.Config')
    def test_s3_download_sets_app_name_on_boto_client(self, boto_cfg, client, get_version):
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        cfg = config_fixture(app_name=app_name)
        boto_cfg_instance = MagicMock()
        boto_cfg.return_value = boto_cfg_instance
        with patch('builtins.open', mock_open()):
            util.download('s3://example/file.txt', 'tmp', access_token='', cfg=cfg)
        boto_cfg.assert_called_with(user_agent_extra=f'harmony (unknown version) harmony-service-lib/{fake_lib_version} ({app_name})')
        client.assert_called_with(service_name='s3', config=boto_cfg_instance, region_name=ANY)

    @patch('harmony_service_lib.util.get_version')
    @patch('harmony_service_lib.aws.download')
    @patch('harmony_service_lib.aws.Config')
    def test_s3_download_does_not_set_api_request_uuid(self, boto_cfg, aws_download, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        cfg = config_fixture(app_name=app_name)
        boto_cfg_instance = MagicMock()
        boto_cfg.return_value = boto_cfg_instance
        with patch('builtins.open', mock_open()):
            util.download('s3://example/file.txt', 'tmp', access_token='', cfg=cfg)
        aws_download.assert_called_with(ANY, 's3://example/file.txt', ANY, ANY )

    @patch('harmony_service_lib.util.get_version')
    @patch.object(Session, 'get')
    def test_http_download_sets_api_request_uuid(self, get, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        cfg = config_fixture(app_name=app_name)
        with patch('builtins.open', mock_open()):
            util.download('http://example/file.txt', 'tmp', access_token='', cfg=cfg)
        get.assert_called_with('http://example/file.txt?A-api-request-uuid=abc123',  headers={'user-agent': f'harmony (unknown version) harmony-service-lib/{fake_lib_version} (gdal-subsetter)'}, timeout=60, stream=True)

    @patch('harmony_service_lib.util.get_version')
    @patch.object(Session, 'get')
    def test_https_download_sets_api_request_uuid(self, get, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        cfg = config_fixture(app_name=app_name)
        with patch('builtins.open', mock_open()):
            util.download('https://example/file.txt', 'tmp', access_token='', cfg=cfg)
        get.assert_called_with('https://example/file.txt?A-api-request-uuid=abc123',  headers={'user-agent': f'harmony (unknown version) harmony-service-lib/{fake_lib_version} (gdal-subsetter)'}, timeout=60, stream=True)

    @patch('harmony_service_lib.util.get_version')
    @patch.object(Session, 'post')
    def test_http_download_with_post_sets_api_request_uuid(self, post, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        data = { 'foo': 'bar' }
        cfg = config_fixture(app_name=app_name)
        with patch('builtins.open', mock_open()):
            util.download('http://example/file.txt', 'tmp', access_token='', data=data, cfg=cfg)
        post.assert_called_with('http://example/file.txt?A-api-request-uuid=abc123',  headers={'user-agent': f'harmony (unknown version) harmony-service-lib/{fake_lib_version} (gdal-subsetter)', 'Content-Type': 'application/x-www-form-urlencoded'}, data = { 'foo': 'bar' }, timeout=60, stream=True)


    @patch('harmony_service_lib.util.get_version')
    @patch.object(Session, 'post')
    def test_https_download_with_post_sets_api_request_uuid(self, post, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        data = { 'foo': 'bar' }
        cfg = config_fixture(app_name=app_name)
        with patch('builtins.open', mock_open()):
            util.download('https://example/file.txt', 'tmp', access_token='', data=data, cfg=cfg)
        post.assert_called_with('https://example/file.txt?A-api-request-uuid=abc123',  headers={'user-agent': f'harmony (unknown version) harmony-service-lib/{fake_lib_version} (gdal-subsetter)', 'Content-Type': 'application/x-www-form-urlencoded'}, data = { 'foo': 'bar' }, timeout=60, stream=True)


    @patch('harmony_service_lib.util.get_version')
    @patch.object(Session, 'post')
    def test_http_download_with_long_url_get_becomes_post(self, post, get_version):
        request_context['request_id'] = 'abc123'
        app_name = 'gdal-subsetter'
        fake_lib_version = '0.1.0'
        get_version.return_value = fake_lib_version
        # set post_url_length to 300 and download with url longer than 300, the download will be done with POST
        cfg = config_fixture(app_name=app_name,post_url_length=300)
        with patch('builtins.open', mock_open()):
            util.download('https://opendap.uat.earthdata.nasa.gov/collections/C1245618475-EEDTEST/granules/GPM_3IMERGHH.06:3B-HHR.MS.MRG.3IMERG.20200118-S233000-E235959.1410.V06B.HDF5.dap.nc4?dap4.ce=%2FGrid%2Ftime%3B%2FGrid%2Flon%3B%2FGrid%2Flat_bnds%3B%2FGrid%2Ftime_bnds%3B%2FGrid%2Flon_bnds%3B%2FGrid%2Flat',
            'tmp',
            access_token='',
            cfg=cfg)
        post.assert_called_with('https://opendap.uat.earthdata.nasa.gov/collections/C1245618475-EEDTEST/granules/GPM_3IMERGHH.06:3B-HHR.MS.MRG.3IMERG.20200118-S233000-E235959.1410.V06B.HDF5.dap.nc4',
        headers={'user-agent': f'harmony (unknown version) harmony-service-lib/{fake_lib_version} (gdal-subsetter)', 'Content-Type': 'application/x-www-form-urlencoded'}, data = 'dap4.ce=%2FGrid%2Ftime%3B%2FGrid%2Flon%3B%2FGrid%2Flat_bnds%3B%2FGrid%2Ftime_bnds%3B%2FGrid%2Flon_bnds%3B%2FGrid%2Flat&A-api-request-uuid=abc123', timeout=60, stream=True)


class TestStage(unittest.TestCase):
    def setUp(self):
        self.config = util.config(validate=False)

    @patch('boto3.client')
    def test_uploads_to_s3_and_returns_its_s3_url(self, client):
        # Sets a non-test ENV environment variable to force things through the (mocked) download path
        s3 = MagicMock()
        s3.generate_presigned_url.return_value = 'https://example.com/presigned.txt'
        client.return_value = s3
        cfg = config_fixture(use_localstack=True, staging_bucket='example', staging_path='staging/path')

        result = util.stage('file.txt', 'remote.txt', 'text/plain', cfg=cfg)

        s3.upload_file.assert_called_with('file.txt', 'example', 'staging/path/remote.txt',
                                          ExtraArgs={'ContentType': 'text/plain'})
        self.assertEqual(result, 's3://example/staging/path/remote.txt')

    @patch('boto3.client')
    def test_uses_location_prefix_when_provided(self, client):
        # Sets a non-test ENV environment variable to force things through the (mocked) download path
        s3 = MagicMock()
        s3.generate_presigned_url.return_value = 'https://example.com/presigned.txt'
        client.return_value = s3
        cfg = config_fixture(use_localstack=True, staging_bucket='example', staging_path='staging/path')

        result = util.stage('file.txt', 'remote.txt', 'text/plain',
                            location="s3://different-example/public/location/", cfg=cfg)

        s3.upload_file.assert_called_with('file.txt', 'different-example', 'public/location/remote.txt',
                                          ExtraArgs={'ContentType': 'text/plain'})
        self.assertEqual(result, 's3://different-example/public/location/remote.txt')


class TestS3Parameters(unittest.TestCase):
    def test_when_using_localstack_it_uses_localstack_host(self):
        use_localstack = True
        localstack_host = 'testhost'
        region = 'tatooine-desert-1'

        expected = {
            'endpoint_url': f'http://{localstack_host}:4566',
            'use_ssl': False,
            'aws_access_key_id': 'ACCESS_KEY',
            'aws_secret_access_key': 'SECRET_KEY',
            'region_name': f'{region}'
        }

        actual = aws.aws_parameters(use_localstack, localstack_host, region)
        self.assertDictEqual(expected, actual)

    def test_when_not_using_localstack_it_ignores_localstack_host(self):
        use_localstack = False
        localstack_host = 'localstack'
        region = 'westeros-north-3'

        expected = {
            'region_name': f'{region}'
        }

        actual = aws.aws_parameters(use_localstack, localstack_host, region)

        self.assertDictEqual(expected, actual)


class TestGenerateOutputFilename(unittest.TestCase):
    def test_includes_provided_suffixes_ext(self):
        """Ensure the correct combinations of regridded, subsetted and
        reformatted are included in the correct order, per the optional
        arguments to the function."""
        url = 'https://example.com/fake-path/abc.123.nc/?query=true'
        ext = 'zarr'

        # Basic cases
        variables = []
        with self.subTest('No suffix options'):
            self.assertEqual(
                util.generate_output_filename(url, ext),
                'abc.123.zarr'
            )
        with self.subTest('Only is_subsetted'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_subsetted=True),
                'abc.123_subsetted.zarr'
            )

        with self.subTest('Only is_regridded'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_regridded=True),
                'abc.123_regridded.zarr'
            )

        with self.subTest('Only is_reformatted'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_reformatted=True),
                'abc.123_reformatted.zarr'
            )

        with self.subTest('is_subsetted and is_regridded'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_subsetted=True, is_regridded=True),
                'abc.123_regridded_subsetted.zarr'
            )

        with self.subTest('is_subsetted, is_regridded with empty variables list'):
            self.assertEqual(
                util.generate_output_filename(
                    url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True
                ),
                'abc.123_regridded_subsetted.zarr'
            )

        with self.subTest('is_subsetted and is_reformatted'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_subsetted=True, is_reformatted=True),
                'abc.123_subsetted_reformatted.zarr'
            )

        with self.subTest('is_regridded and is_reformatted'):
            self.assertEqual(
                util.generate_output_filename(url, ext, is_regridded=True, is_reformatted=True),
                'abc.123_regridded_reformatted.zarr'
            )

        with self.subTest('is_subsetted, is_regridded and is_reformatted'):
            self.assertEqual(
                util.generate_output_filename(
                    url, ext, is_subsetted=True, is_regridded=True, is_reformatted=True
                ),
                'abc.123_regridded_subsetted_reformatted.zarr'
            )

    def test_includes_single_variable_name_replacing_slashes(self):
        url = 'https://example.com/fake-path/abc.123.nc/?query=true'
        ext = 'zarr'

        # Variable name contains full path with '/' ('/' replaced with '_')
        variables = ['/path/to/VarB']
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True),
            'abc.123_path_to_VarB_regridded_subsetted.zarr'
        )

    def test_decodes_encoded_chars(self):
        url = 'https://example.com/fake-path/GPM_3IMERGHH.06%5D3B-HHR.MS.MRG.3IMERG.20200101-S120000-E122959.0720.V06B.HDF5'
        self.assertEqual(
            util.generate_output_filename(url),
            'GPM_3IMERGHH.06]3B-HHR.MS.MRG.3IMERG.20200101-S120000-E122959.0720.V06B.HDF5'
        )

    def test_replaces_encoded_slash_with_underscore(self):
        url = 'https://example.com/fake-path/a/b/a%2fb%2F%2Fc.hdf5'
        self.assertEqual(
            util.generate_output_filename(url),
            'a_b_c.hdf5'
        )

    def test_runs_of_underscores_replaced_with_single(self):
        url = 'https://example.com/fake-path/granule__base___name.nc4'
        self.assertEqual(
            util.generate_output_filename(url, variable_subset=['/Grid/precipitationCal']),
            'granule_base_name_Grid_precipitationCal.nc4'
        )

    def test_leading_or_trailing_underscores_are_removed(self):
        url = 'https://example.com/fake-path/__granule__base___name.nc4__'
        self.assertEqual(
            util.generate_output_filename(url, variable_subset=['/Grid/precipitationCal']),
            'granule_base_name_Grid_precipitationCal.nc4'
        )

    def test_underscores_before_or_after_periods_are_removed(self):
        url = 'https://example.com/fake-path/__granule__base___name_.__nc4__'
        self.assertEqual(
            util.generate_output_filename(url, variable_subset=['/Grid/precipitationCal']),
            'granule_base_name_Grid_precipitationCal.nc4'
        )

    def test_replaces_colon_with_underscore(self):
        url = 'https://example.com/fake-path/q:q.nc4'
        self.assertEqual(
            util.generate_output_filename(url),
            'q_q.nc4'
        )
        url = 'https://example.com/fake-path/q%3Aq.nc4'
        self.assertEqual(
            util.generate_output_filename(url),
            'q_q.nc4'
        )
        url = 'https://example.com/fake-path/q%3Aq:q%2fq.nc4'
        self.assertEqual(
            util.generate_output_filename(url),
            'q_q_q_q.nc4'
        )

    def test_includes_single_variable(self):
        url = 'https://example.com/fake-path/abc.123.nc/?query=true'
        ext = 'zarr'

        # Single variable cases
        variables = ['VarA']
        self.assertEqual(
            util.generate_output_filename(url, ext),
            'abc.123.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(url, ext, is_subsetted=True, is_regridded=True),
            'abc.123_regridded_subsetted.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables),
            'abc.123_VarA.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True),
            'abc.123_VarA_regridded_subsetted.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(
                url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True, is_reformatted=True,
            ),
            'abc.123_VarA_regridded_subsetted_reformatted.zarr'
        )

    def test_excludes_multiple_variable(self):
        url = 'https://example.com/fake-path/abc.123.nc/?query=true'
        ext = 'zarr'

        # Multiple variable cases (no variable name in suffix)
        variables = ['VarA', 'VarB']
        self.assertEqual(
            util.generate_output_filename(url, ext, is_subsetted=True, is_regridded=True),
            'abc.123_regridded_subsetted.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True),
            'abc.123_regridded_subsetted.zarr'
        )

    def test_avoids_overwriting_single_suffixes(self):
        ext = 'zarr'

        # URL already containing a suffix
        variables = ['VarA']
        url = 'https://example.com/fake-path/abc.123_regridded.zarr'
        self.assertEqual(
            util.generate_output_filename(url, ext, is_subsetted=True),
            'abc.123_regridded_subsetted.zarr'
        )
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True),
            'abc.123_VarA_regridded_subsetted.zarr'
        )

    def test_avoids_overwriting_multiple_suffixes(self):
        ext = 'zarr'
        # URL already containing all suffixes
        variables = ['VarA']
        url = 'https://example.com/fake-path/abc.123_VarA_regridded_subsetted.zarr'
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables, is_subsetted=True, is_regridded=True),
            'abc.123_VarA_regridded_subsetted.zarr'
        )

    def test_allows_variable_objects(self):
        ext = 'zarr'
        # URL already containing all suffixes
        variables = [Variable({'name': 'VarA'})]
        url = 'https://example.com/fake-path/abc.123.zarr'
        self.assertEqual(
            util.generate_output_filename(url, ext, variable_subset=variables),
            'abc.123_VarA.zarr'
        )


class TestBboxToGeometry(unittest.TestCase):
    def test_provides_a_single_polygon_for_bboxes_not_crossing_the_antimeridian(self):
        self.assertEqual(
            util.bbox_to_geometry([100, 0, -100, 50]),
            {
                'type': 'MultiPolygon',
                'coordinates': [
                    [[[-180, 0], [-180, 50], [-100, 50], [-100, 0], [-180, 0]]],
                    [[[100, 0], [100, 50], [180, 50], [180, 0], [100, 0]]]
                ]
            })

    def test_splits_bboxes_that_cross_the_antimeridian(self):
        self.assertEqual(
            util.bbox_to_geometry([-100, 0, 100, 50]),
            {
                'type': 'Polygon',
                'coordinates': [
                    [[-100, 0], [-100, 50], [100, 50], [100, 0], [-100, 0]]
                ]
            })
