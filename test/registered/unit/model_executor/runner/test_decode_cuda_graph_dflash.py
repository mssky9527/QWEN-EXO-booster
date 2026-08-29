import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from sglang.srt.model_executor.runner.decode_cuda_graph_runner import (
    DecodeCudaGraphRunner,
)
from sglang.test.ci.ci_register import register_cpu_ci
from sglang.test.test_utils import CustomTestCase

register_cpu_ci(est_time=1, suite="base-a-test-cpu")


class TestDFlashTargetOnlyCudaGraph(CustomTestCase):
    def test_target_only_batch_rejects_dflash_width_graph(self):
        runner = DecodeCudaGraphRunner.__new__(DecodeCudaGraphRunner)
        runner.model_runner = SimpleNamespace(
            spec_algorithm=MagicMock(is_dflash_family=MagicMock(return_value=True))
        )
        forward_batch = SimpleNamespace(
            replace_embeds=None,
            spec_algorithm=MagicMock(is_none=MagicMock(return_value=True)),
        )

        self.assertFalse(runner.can_run_graph(forward_batch))


if __name__ == "__main__":
    unittest.main()
