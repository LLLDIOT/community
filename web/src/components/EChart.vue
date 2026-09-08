<template>
  <div ref="el" :style="{ width: '100%', height }"></div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '300px' },
});

const el = ref(null);
let chart = null;

function render() {
  if (!chart && el.value) chart = echarts.init(el.value);
  if (chart) chart.setOption(props.option, true);
}

function resize() {
  chart?.resize();
}

onMounted(() => {
  render();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  chart?.dispose();
  chart = null;
});

watch(() => props.option, render, { deep: true });
</script>
