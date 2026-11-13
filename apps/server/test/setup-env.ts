// 自动化测试使用独立的数据库与存储桶，并且只用测试代码内的假供应商（D-31），不调用任何付费接口
import { resolve } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://aicreative:aicreative@localhost:5432/aicreative_test';
process.env.S3_BUCKET = 'ai-creative-test';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
process.env.S3_ACCESS_KEY_ID = 'minioadmin';
process.env.S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.DEV_LOGIN_ENABLED = 'true';
process.env.WORKER_IN_PROCESS = 'false';
process.env.MODEL_IMAGE_TRANSPORT = 'base64';
// 测试默认组合固定为 Seedance + Seedream；Vertex 组合在 multi-provider 测试里切换配置后新建项目
process.env.VIDEO_MODEL = 'seedance-2.5';
process.env.IMAGE_MODEL = 'seedream-5.0-pro';
process.env.LLM_PROVIDER = 'deepseek';
process.env.ARK_VIDEO_MAX_CONCURRENCY = '3';
process.env.ARK_VIDEO_RPM = '180';
process.env.VERTEX_PROJECT_ID = '';
process.env.VERTEX_LOCATION = 'global';
process.env.VERTEX_VIDEO_MAX_CONCURRENCY = '2';
process.env.VERTEX_VIDEO_RPM = '30';
process.env.VIRTUAL_PORTRAITS_FILE = resolve(__dirname, 'fixtures', 'virtual-portraits.json');
process.env.TMP_DIR = '.tmp/test';
// 确保测试不会因为本机 .env 里的密钥而误调真实接口
process.env.ARK_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.LLM_API_KEY = '';
