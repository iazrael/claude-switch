#!/usr/bin/env node
const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const manager = require('./lib/profile-manager');

// 交互：添加套餐
async function addProfileUI(name) {
  if (!name) {
    const answer = await inquirer.prompt([
      { type: 'input', name: 'name', message: '套餐名称（如 aliyun-pro）：' },
    ]);
    name = answer.name.trim();
  }
  if (!name) return console.log(chalk.red('名称不能为空'));

  console.log(chalk.cyan(`配置套餐 "${name}" 的环境变量（回车跳过）：`));
  const envAnswers = await inquirer.prompt([
    { type: 'input', name: 'ANTHROPIC_AUTH_TOKEN', message: 'API Key' },
    { type: 'input', name: 'ANTHROPIC_BASE_URL', message: 'Base URL' },
    { type: 'input', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL', message: 'Sonnet 模型（日常开发主力）' },
    { type: 'input', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL', message: 'Opus 模型（复杂任务，可选）' },
    { type: 'input', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', message: 'Haiku 模型（轻量任务，可选）' },
  ]);

  const env = {};
  for (const [k, v] of Object.entries(envAnswers)) {
    if (v.trim()) env[k] = v.trim();
  }
  if (Object.keys(env).length === 0) {
    return console.log(chalk.red('至少需要一个环境变量'));
  }

  await manager.addProfile(name, env);
  console.log(chalk.green(`套餐 "${name}" 已保存`));
}

// 交互：删除套餐
async function removeProfileUI(name) {
  const names = await manager.getAllProfileNames();
  if (names.length === 0) return console.log(chalk.yellow('没有套餐可删除'));

  if (!name) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'name',
        message: '选择要删除的套餐：',
        choices: names,
      },
    ]);
    name = answer.name;
  }
  try {
    await manager.removeProfile(name);
    console.log(chalk.green(`套餐 "${name}" 已删除`));
  } catch (err) {
    console.log(chalk.red(err.message));
  }
}

// 交互：切换套餐
async function switchProfileUI(name) {
  const names = await manager.getAllProfileNames();
  if (names.length === 0) return console.log(chalk.red('请先添加套餐'));

  // 获取当前 active 套餐
  const currentProfile = await manager.getActiveProfile();

  if (!name) {
    const choices = names.map(n => {
      const isCurrent = n === currentProfile;
      return {
        name: isCurrent ? `${n} ${chalk.green('(当前)')}` : n,
        value: n,
      };
    });
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'name',
        message: currentProfile
          ? `选择要切换的套餐（当前: ${currentProfile}）：`
          : '选择要切换的套餐（当前: 未知）：',
        choices,
      },
    ]);
    name = answer.name;
  }
  try {
    await manager.switchProfile(name);
    console.log(chalk.green(`已切换到套餐 "${name}"，重启 Claude Code 生效`));
  } catch (err) {
    console.log(chalk.red(err.message));
  }
}

// 查看当前 env
async function showCurrent() {
  const data = await manager.checkMismatch();
  const env = await manager.getCurrentEnv();
  if (Object.keys(env).length === 0)
    return console.log(chalk.cyan('当前未配置环境变量'));

  if (data.active) {
    console.log(chalk.cyan(`当前套餐: ${chalk.green(data.active)}`));
    if (data.mismatch) {
      console.log(chalk.yellow('⚠️  环境已变更（当前 settings.json 与选中套餐不一致）'));
    }
  } else {
    console.log(chalk.cyan('当前套餐: ') + chalk.yellow('未知'));
  }

  console.log(chalk.cyan('当前 settings.json 中的 env：'));
  for (const [k, v] of Object.entries(env)) {
    const val = k.toLowerCase().includes('token') ? '***' : v;
    console.log(`  ${chalk.green(k)}: ${val}`);
  }
}

// 列出所有套餐
async function listProfiles() {
  const profileData = await manager.getProfiles();
  const mismatchInfo = await manager.checkMismatch();
  const profiles = profileData.profiles || {};
  const names = Object.keys(profiles);
  if (names.length === 0)
    return console.log(chalk.yellow('没有已保存的套餐'));

  console.log(chalk.cyan('已保存的套餐：'));
  for (const name of names) {
    const isActive = name === mismatchInfo.active;
    const prefix = isActive ? chalk.green('●') : chalk.green('■');
    let line = `  ${prefix} ${name}`;
    if (isActive) {
      line += chalk.green(' [当前]');
      if (mismatchInfo.mismatch) {
        line += chalk.yellow(' [环境已变更]');
      }
    }
    console.log(line);
    const env = profiles[name].env;
    for (const [k, v] of Object.entries(env || {})) {
      const val = k.toLowerCase().includes('token') ? '***' : v;
      console.log(`    ${k}: ${val}`);
    }
  }
}

// 首次安装：检测并导入现有 settings.json 配置
async function firstInstallImport() {
  if (!(await manager.isFirstInstall())) return false;

  const existing = await manager.detectExistingConfig();
  if (!existing) return false;

  console.log(chalk.cyan('\n检测到当前 Claude Code 配置：'));
  for (const [k, v] of Object.entries(existing)) {
    const val = k.toLowerCase().includes('token') ? '***' : v;
    console.log(`  ${chalk.green(k)}: ${val}`);
  }
  console.log('');

  const { importIt } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'importIt',
      message: '是否将以上配置导入为第一个套餐？',
      default: true,
    },
  ]);

  if (!importIt) return false;

  const { profileName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'profileName',
      message: '请输入套餐名称：',
      default: 'default',
      validate: (v) => v.trim() ? true : '名称不能为空',
    },
  ]);

  await manager.addProfile(profileName.trim(), existing);
  console.log(chalk.green(`\n已导入套餐 "${profileName.trim()}"，可随时用 claude-switch switch 切换`));
  return true;
}

// 命令行框架
const program = new Command();
program
  .name('claude-switch')
  .description('Claude Code 套餐快速切换工具')
  .version('3.0.0');

program
  .command('current')
  .description('查看当前环境变量')
  .action(showCurrent);

program
  .command('list')
  .alias('ls')
  .description('列出所有套餐')
  .action(listProfiles);

program
  .command('add [name]')
  .description('添加套餐')
  .action(addProfileUI);

program
  .command('remove [name]')
  .alias('rm')
  .description('删除套餐')
  .action(removeProfileUI);

program
  .command('switch [name]')
  .description('切换套餐')
  .action(switchProfileUI);

// ─── serve 子命令 ───
async function serveAction(opts) {
  const serve = require('./lib/serve');
  const { stop: stopFlag, status: statusFlag, daemon, port: portStr } = opts;

  // 互斥校验
  const controlFlags = [stopFlag, statusFlag].filter(Boolean).length;
  const runFlags = [daemon, portStr].filter(Boolean).length;
  if (controlFlags > 1) {
    console.error(chalk.red('错误: --stop 和 --status 不能同时指定'));
    process.exit(1);
  }
  if (controlFlags === 1 && runFlags > 0) {
    console.error(chalk.red('错误: --stop/--status 与 -d/-p 互斥'));
    process.exit(1);
  }

  // 端口解析：-p > CLAUDE_SWITCH_PORT > 3333
  const port = serve._internal.resolvePort(portStr);

  // 分发
  if (stopFlag) return serve.stop();
  if (statusFlag) return serve.status();
  if (daemon) return serve.startDaemon(port);
  return serve.startForeground(port);
}

program
  .command('serve')
  .description('启动 Web 管理服务')
  .option('-p, --port <port>', '指定端口')
  .option('-d, --daemon', '后台运行')
  .option('--stop', '停止服务')
  .option('--status', '查看服务状态')
  .action(serveAction);

// 无参数时显示当前配置
if (process.argv.length === 2) {
  (async () => {
    try {
      await manager.init();
      await showCurrent();
    } catch (err) {
      console.error(chalk.red('操作失败: ' + err.message));
      process.exit(1);
    }
  })();
} else {
  // 有参数时也确保 init 完成后再 parse
  manager.init().then(() => {
    program.parse(process.argv);
  }).catch(err => {
    console.error(chalk.red('初始化失败: ' + err.message));
    process.exit(1);
  });
}