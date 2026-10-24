"""Splitting a run across machines: every game lands in exactly one share."""

import pytest

from coach.analysis import shard_ids

IDS = [str(146_000_000_000 + n) for n in range(600)]


def test_shards_partition_the_games():
    shares = [shard_ids(IDS, f"{i}/3") for i in (1, 2, 3)]
    assert sorted(g for share in shares for g in share) == sorted(IDS)
    assert all(150 <= len(share) <= 250 for share in shares)


def test_shard_keeps_order_and_none_means_all():
    assert shard_ids(IDS, None) == IDS
    share = shard_ids(IDS, "2/3")
    assert share == [g for g in IDS if g in set(share)]


@pytest.mark.parametrize("bad", ["0/3", "4/3"])
def test_shard_rejects_out_of_range(bad):
    with pytest.raises(SystemExit):
        shard_ids(IDS, bad)
