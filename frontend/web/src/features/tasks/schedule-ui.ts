import type { ScheduleCadence, ScheduledTask } from '@qzda/web-types';

export function cadenceLabel(cadence: ScheduleCadence) {
  if (cadence === 'hourly') return '每小时';
  if (cadence === 'weekly') return '每周';
  if (cadence === 'once') return '单次';
  return '每天';
}

export function scheduleWhen(job: ScheduledTask) {
  const hh = String(job.hour ?? 0).padStart(2, '0');
  const mm = String(job.minute ?? 0).padStart(2, '0');
  if (job.cadence === 'hourly') return '每小时整点';
  if (job.cadence === 'weekly') {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${days[job.weekday ?? 1] ?? '周一'} ${hh}:${mm}`;
  }
  if (job.cadence === 'once') return job.runAt ? new Date(job.runAt).toLocaleString('zh-CN') : '未设置';
  return `每天 ${hh}:${mm}`;
}

export function scheduleStatusLabel(status: ScheduledTask['status']) {
  if (status === 'paused') return '已暂停';
  if (status === 'expired') return '已结束';
  return '进行中';
}
