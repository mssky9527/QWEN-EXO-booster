import inspect
import unittest

from types import SimpleNamespace
from sglang.test.ci.ci_register import register_cpu_ci
from sglang.test.test_utils import maybe_stub_sgl_kernel

maybe_stub_sgl_kernel()

from sglang.srt.disaggregation.decode import SchedulerDisaggregationDecodeMixin
from sglang.srt.disaggregation.prefill import SchedulerDisaggregationPrefillMixin
from sglang.srt.managers.scheduler import Scheduler

register_cpu_ci(est_time=3, suite="base-a-test-cpu")

FORBIDDEN_TOKENS = ("self.running_batch", "self.last_batch", "self.cur_batch")

DECISION_METHODS = (
    Scheduler.get_next_batch_to_run,
    Scheduler.get_new_batch_prefill,
    Scheduler._get_new_batch_prefill_raw,
    Scheduler._abort_on_running_timeout,
    Scheduler.is_disable_overlap_for_batch,
    SchedulerDisaggregationPrefillMixin.get_next_disagg_prefill_batch_to_run,
    SchedulerDisaggregationPrefillMixin.process_prefill_chunk,
    SchedulerDisaggregationDecodeMixin.get_new_prebuilt_batch,
    SchedulerDisaggregationDecodeMixin.get_next_disagg_decode_batch_to_run,
)


class TestDecisionMethodsHaveNoHiddenBatchChannel(unittest.TestCase):
    def test_decision_methods_take_batches_as_params_not_self(self):
        """The batch decision tree must receive running/last batch as params, never via self.*."""
        for method in DECISION_METHODS:
            source = inspect.getsource(inspect.unwrap(method))
            self.assertIn(
                f"def {method.__name__}",
                source,
                msg=f"failed to read the real source of {method.__qualname__}",
            )
            for token in FORBIDDEN_TOKENS:
                self.assertNotIn(
                    token,
                    source,
                    msg=(
                        f"{method.__qualname__} references {token}; pass the batch "
                        "explicitly and return it via NextBatchPlan instead."
                    ),
                )


class TestDFlashActiveBatchIsolation(unittest.TestCase):
    @staticmethod
    def _request(kind, dflash_mode=None):
        custom_params = {"qwen_exo_kind": kind}
        if dflash_mode is not None:
            custom_params["qwen_exo_dflash"] = dflash_mode
        return SimpleNamespace(
            finished=lambda: False,
            return_hidden_states=False,
            sampling_params=SimpleNamespace(
                custom_params=custom_params,
                json_schema=None,
                regex=None,
                ebnf=None,
                structural_tag=None,
            ),
        )

    def test_inflight_last_batch_blocks_opposite_target_only_prefill(self):
        running_batch = SimpleNamespace(reqs=[self._request("user")])
        last_batch = SimpleNamespace(reqs=[self._request("internal")])

        self.assertEqual(
            Scheduler._dflash_active_request_flags(running_batch, last_batch),
            (False, True),
        )

    def test_plain_internal_eligible_request_stays_in_speculative_lane(self):
        batch = SimpleNamespace(
            reqs=[self._request("internal", dflash_mode="eligible")]
        )

        self.assertEqual(
            Scheduler._dflash_active_request_flags(batch),
            (False, True),
        )

    @staticmethod
    def _batch(reqs, *, target_only, spec_info=None):
        return SimpleNamespace(
            reqs=reqs,
            is_empty=lambda: not reqs,
            spec_algorithm=SimpleNamespace(is_none=lambda: target_only),
            spec_info=spec_info,
        )

    def test_batch_mode_blocks_opposite_lane_when_request_metadata_is_stale(self):
        running_batch = self._batch(
            [self._request("internal", dflash_mode="eligible")],
            target_only=True,
        )
        last_batch = self._batch(
            [self._request("user")],
            target_only=False,
        )

        self.assertEqual(
            Scheduler._dflash_active_request_flags(running_batch, last_batch),
            (True, True),
        )

    def test_incompatible_batch_lanes_are_not_mergeable(self):
        speculative_batch = self._batch(
            [self._request("user")],
            target_only=False,
        )
        target_only_batch = self._batch(
            [self._request("internal")],
            target_only=True,
        )

        self.assertFalse(
            Scheduler._dflash_batches_are_compatible(
                speculative_batch, target_only_batch
            )
        )

    def test_same_batch_lane_is_mergeable(self):
        left = self._batch([self._request("user")], target_only=False)
        right = self._batch([self._request("user")], target_only=False)

        self.assertTrue(Scheduler._dflash_batches_are_compatible(left, right))

    def test_spec_metadata_mismatch_is_not_mergeable(self):
        left = self._batch(
            [self._request("user")], target_only=False, spec_info=object()
        )
        right = self._batch([self._request("user")], target_only=False)

        self.assertFalse(Scheduler._dflash_batches_are_compatible(left, right))


if __name__ == "__main__":
    unittest.main()
