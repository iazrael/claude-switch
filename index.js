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
    { type: 'input', name: 'ANTHROPIC_MODEL', message: '模型名称' },
    { type: 'input', name: 'ANTHROPIC_SMALL_FAST_MODEL', message: '轻量模型（可选）' },
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

  if (!name) {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'name',
        message: '选择要切换的套餐：',
        choices: names,
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
  const env = await manager.getCurrentEnv();
  if (Object.keys(env).length === 0)
    return console.log(chalk.cyan('当前未配置环境变量'));
  console.log(chalk.cyan('当前 settings.json 中的 env：'));
  for (const [k, v] of Object.entries(env)) {
    const val = k.toLowerCase().includes('token') ? '***' : v;
    console.log(`  ${chalk.green(k)}: ${val}`);
  }
}

// 列出所有套餐
async function listProfiles() {
  const profiles = await manager.getProfiles();
  const names = Object.keys(profiles);
  if (names.length === 0)
    return console.log(chalk.yellow('没有已保存的套餐'));
  console.log(chalk.cyan('已保存的套餐：'));
  for (const name of names) {
    console.log(`  ${chalk.green('■')} ${name}`);
    const env = profiles[name].env;
    for (const [k, v] of Object.entries(env || {})) {
      const val = k.toLowerCase().includes('token') ? '***' : v;
      console.log(`    ${k}: ${val}`);
    }
  }
}

// 命令行框架
const program = new Command();
program
  .name('claude-switch')
  .description('Claude Code 套餐快速切换工具')
  .version('2.0.0');

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

// 无参数时默认进入切换
if (process.argv.length === 2) {
  switchProfileUI();
} else {
  program.parse(process.argv);
}
